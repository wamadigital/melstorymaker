package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

const activityJob = "52a44790-8d33-42a1-a61a-11a399ab75f1"
const activityOtherJob = "94cc3918-bd8b-494d-a13f-63da5c811b63"

func activityFixture(t *testing.T) (*localActivityStore, []types.JID, time.Time) {
	t.Helper()
	s, err := newLocalActivityStore(filepath.Join(t.TempDir(), "activity.db"), localTestToken)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.db.Close() })
	now := time.Now().UTC().Truncate(time.Millisecond)
	s.beginCoverage(now.Add(-16 * 24 * time.Hour))
	s.lastCheck = now
	return s, []types.JID{types.NewJID(localTestRecipient, types.DefaultUserServer), types.NewJID("987654321", types.HiddenUserServer)}, now
}

func TestActivityNeedsFullWindowAndKnownAliases(t *testing.T) {
	s, ids, now := activityFixture(t)
	if result := s.decision(ids, activityJob, 15, now); !result.Allowed || !result.Activity.Complete {
		t.Fatal("complete silent coverage should allow")
	}
	if result := s.decision(ids[:1], activityJob, 5, now); result.Allowed || result.Activity.Complete {
		t.Fatal("missing LID must fail closed")
	}
	s.beginCoverage(now.Add(-6 * 24 * time.Hour))
	s.lastCheck = now
	if !s.decision(ids, activityJob, 5, now).Allowed {
		t.Fatal("six days cover the five day window")
	}
	if s.decision(ids, activityJob, 15, now).Allowed {
		t.Fatal("six days cannot cover fifteen days")
	}
}

func TestActivityIncludesIncomingOutgoingMediaAndUndecryptableMetadata(t *testing.T) {
	for _, fromMe := range []bool{false, true} {
		s, ids, now := activityFixture(t)
		original := localActivityRecorder
		localActivityRecorder = s
		info := types.MessageInfo{MessageSource: types.MessageSource{Chat: ids[1], IsFromMe: fromMe}, ID: "arbitrary-fixture-id", Timestamp: now.Add(-24 * time.Hour), MediaType: "audio"}
		if fromMe {
			info.RecipientAlt = ids[0]
		} else {
			info.SenderAlt = ids[0]
		}
		recordLocalActivityEvent(nil, &events.UndecryptableMessage{Info: info})
		localActivityRecorder = original
		decision := s.decision(ids, activityJob, 5, now)
		if decision.Allowed || decision.Code != "inactivity_recent" || decision.Activity.LastInteractionAt == nil {
			t.Fatal("all individual message metadata must block")
		}
	}
}

func TestActivityExcludesOnlyExactCurrentJobOwnIDs(t *testing.T) {
	s, ids, now := activityFixture(t)
	s.record(ids, "local-send-1", activityJob, now.Add(-time.Second))
	// The SDK own-device echo arrives without a job annotation.
	s.record(ids, "local-send-1", "", now.Add(-time.Second))
	if !s.decision(ids, activityJob, 5, now).Allowed {
		t.Fatal("own current sequence must not block itself")
	}
	if s.decision(ids, activityOtherJob, 15, now).Allowed {
		t.Fatal("a previous/other sequence must count as interaction")
	}
	s.record(ids, "new-incoming", "", now)
	if s.decision(ids, activityJob, 5, now).Allowed {
		t.Fatal("a reply during the pause must stop remaining parts")
	}
}

func TestActivityWindowBoundaryAndOtherContacts(t *testing.T) {
	s, ids, now := activityFixture(t)
	other := []types.JID{types.NewJID("5511999999999", types.DefaultUserServer)}
	s.record(other, "other-contact", "", now)
	if !s.decision(ids, activityJob, 5, now).Allowed {
		t.Fatal("unrelated contact must not block")
	}
	s.record(ids, "boundary", "", now.Add(-5*24*time.Hour))
	if !s.decision(ids, activityJob, 5, now).Allowed {
		t.Fatal("a full five days since interaction permits sending")
	}
	s.record(ids, "inside-window", "", now.Add(-5*24*time.Hour+time.Millisecond))
	if s.decision(ids, activityJob, 5, now).Allowed {
		t.Fatal("interaction newer than the boundary must block")
	}
}

func TestActivityNeverStoresRawContactMessageJobOrContent(t *testing.T) {
	s, ids, now := activityFixture(t)
	s.record(ids, "raw-message-id-fixture", activityJob, now)
	var contact, event, job string
	if err := s.db.QueryRow("SELECT contact_hash,event_hash,job_hash FROM activity LIMIT 1").Scan(&contact, &event, &job); err != nil {
		t.Fatal(err)
	}
	for _, hash := range []string{contact, event, job} {
		if len(hash) != 64 {
			t.Fatal("only keyed hashes may be persisted")
		}
	}
	var name string
	if err := s.db.QueryRow("SELECT file FROM pragma_database_list WHERE name='main'").Scan(&name); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{localTestRecipient, "987654321", activityJob, "raw-message-id-fixture"} {
		if strings.Contains(string(data), raw) {
			t.Fatal("private identifier persisted in plain text")
		}
	}
}

func TestActivityDisconnectRestartAndSleepResetCoverage(t *testing.T) {
	s, ids, now := activityFixture(t)
	s.invalidate()
	if s.decision(ids, activityJob, 5, now).Allowed {
		t.Fatal("disconnect must fail closed")
	}
	s.beginCoverage(now)
	if s.decision(ids, activityJob, 5, now).Allowed {
		t.Fatal("reconnection starts a new observation window")
	}
	s.coverage = now.Add(-16 * 24 * time.Hour)
	s.lastCheck = now.Add(-10 * time.Minute)
	s.heartbeat(now)
	if s.decision(ids, activityJob, 5, now).Allowed {
		t.Fatal("sleep/clock jump must reset coverage")
	}
	var file string
	s.db.QueryRow("SELECT file FROM pragma_database_list WHERE name='main'").Scan(&file)
	reopened, err := newLocalActivityStore(file, localTestToken)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.db.Close()
	if reopened.decision(ids, activityJob, 5, now).Allowed {
		t.Fatal("restart must never restore unverified coverage")
	}
}

func TestActivityDatabaseFailureCannotAllow(t *testing.T) {
	s, ids, now := activityFixture(t)
	s.db.Close()
	if s.decision(ids, activityJob, 5, now).Allowed {
		t.Fatal("database failure must fail closed")
	}
}

func TestActivitySendNeedsFreshGateAndStopsReplyDuringCloudAck(t *testing.T) {
	s, ids, now := activityFixture(t)
	if s.canSend(ids, activityJob, now) {
		t.Fatal("a direct automation marker cannot bypass the gate")
	}
	if !s.decision(ids, activityJob, 5, now).Allowed || !s.canSend(ids, activityJob, now.Add(time.Second)) {
		t.Fatal("a fresh verified gate should authorize locally")
	}
	if s.canSend(ids, activityJob, now.Add(32*time.Second)) {
		t.Fatal("the authorization cannot outlive thirty seconds")
	}
	s.decision(ids, activityJob, 5, now.Add(32*time.Second))
	s.record(ids, "reply-during-cloud-ack", "", now.Add(33*time.Second))
	if s.canSend(ids, activityJob, now.Add(34*time.Second)) {
		t.Fatal("the bridge must recheck interaction immediately before send")
	}
}

func TestActivityEndpointSimulationIsPrivateAndFailsClosed(t *testing.T) {
	handler := localTestHandler(t, nil)
	request := localTestRequest(http.MethodPost, "/api/activity-check", `{"recipient":"`+localTestRecipient+`","jobId":"`+activityJob+`","days":5}`)
	response := localTestRun(t, handler, request, http.StatusOK, "")
	var decision localActivityDecision
	if err := json.Unmarshal(response.Body.Bytes(), &decision); err != nil {
		t.Fatal(err)
	}
	if decision.Allowed || decision.Activity.Complete || decision.Code != "inactivity_unverified" {
		t.Fatal("simulation must not prove contact silence")
	}
	if strings.Contains(response.Body.String(), localTestRecipient) || strings.Contains(response.Body.String(), activityJob) {
		t.Fatal("proof must never export contact identifiers")
	}
	for _, body := range []string{`{}`, `{"recipient":"` + localTestRecipient + `","jobId":"` + activityJob + `","days":1}`, `{"recipient":"` + localTestRecipient + `","jobId":"bad","days":5}`} {
		localTestRun(t, handler, localTestRequest(http.MethodPost, "/api/activity-check", body), http.StatusBadRequest, "invalid_payload")
	}
}
