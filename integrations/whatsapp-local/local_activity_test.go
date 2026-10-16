package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"go.mau.fi/whatsmeow/util/keys"
	waLog "go.mau.fi/whatsmeow/util/log"
)

const activityJob = "52a44790-8d33-42a1-a61a-11a399ab75f1"
const activityOtherJob = "94cc3918-bd8b-494d-a13f-63da5c811b63"
const ownerTestLead = "01b985e2-6bff-4e9c-bb5e-2f1cc280edf7"
const ownerOtherTestLead = "d459193f-9e7c-4b2c-995d-7f829a0936bd"

func ownerTestTime() time.Time {
	return time.Date(2026, time.October, 15, 18, 0, 0, 0, time.UTC)
}

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

func TestOwnerTestAuthorizationDoesNotInventInactivityProof(t *testing.T) {
	s, ids, _ := activityFixture(t)
	now := ownerTestTime()
	s.beginCoverage(now)
	if s.canSendOwnerTest(localOwnerTestRecipient, ownerTestLead, activityJob, now) {
		t.Fatal("test sends need a fresh explicit activity-check authorization")
	}
	decision := s.authorizeOwnerTest(localOwnerTestRecipient, ownerTestLead, activityJob, now)
	if !decision.Allowed || decision.Code != "owner_test_authorized" || decision.Activity != nil || decision.CheckedAt == nil || !decision.CheckedAt.Equal(now) || decision.JobID != activityJob || decision.Recipient != localOwnerTestRecipient || decision.TestLeadID != ownerTestLead {
		t.Fatal("owner test authorization must be explicit and bound to the exact request")
	}
	encoded, err := json.Marshal(decision)
	if err != nil || strings.Contains(string(encoded), `"activity"`) || strings.Contains(string(encoded), "coverageStartedAt") {
		t.Fatal("owner tests must not fabricate a normal inactivity proof")
	}
	if !s.canSendOwnerTest(localOwnerTestRecipient, ownerTestLead, activityJob, now.Add(time.Second)) {
		t.Fatal("matching fresh owner test authorization should permit receipt testing")
	}
	if s.canSend(ids, activityJob, now.Add(time.Second)) || s.decision(ids, activityOtherJob, 5, now.Add(time.Second)).Allowed {
		t.Fatal("owner test authorization must not authorize a normal-client send")
	}
}

func TestOwnerTestAllowlistRecipientAndDeadlineAreExact(t *testing.T) {
	s, _, _ := activityFixture(t)
	now := ownerTestTime()
	for _, lead := range []string{
		ownerTestLead, ownerOtherTestLead,
		"13e49741-9d35-404c-ae54-42fe93e55c66", "abf88ff2-ea34-4e32-994d-f7dc75df599b", "9263d823-d059-4e0a-b759-9184035dec89",
	} {
		if !s.authorizeOwnerTest(localOwnerTestRecipient, lead, activityJob, now).Allowed {
			t.Fatal("all five explicitly authorized test cards should pass")
		}
	}
	for _, test := range []struct {
		recipient, lead, job string
		at                   time.Time
	}{
		{"5511999999999", ownerTestLead, activityJob, now},
		{"19988763916", ownerTestLead, activityJob, now},
		{localOwnerTestRecipient, activityOtherJob, activityJob, now},
		{localOwnerTestRecipient, strings.ToUpper(ownerTestLead), activityJob, now},
		{localOwnerTestRecipient, ownerTestLead, "bad-job", now},
		{localOwnerTestRecipient, ownerTestLead, activityJob, localOwnerTestExpiresAt},
		{localOwnerTestRecipient, ownerTestLead, activityJob, localOwnerTestExpiresAt.Add(time.Second)},
	} {
		result := s.authorizeOwnerTest(test.recipient, test.lead, test.job, test.at)
		if result.Allowed || result.Activity != nil || result.Code != "owner_test_denied" || s.canSendOwnerTest(test.recipient, test.lead, test.job, test.at) {
			t.Fatal("unauthorized recipient, lead, job, or expired test must fail closed")
		}
	}
}

func TestOwnerTestAuthorizationCannotBeReplayedForAnotherPairOrAfterDisconnect(t *testing.T) {
	s, _, _ := activityFixture(t)
	now := ownerTestTime()
	s.authorizeOwnerTest(localOwnerTestRecipient, ownerTestLead, activityJob, now)
	if s.canSendOwnerTest(localOwnerTestRecipient, ownerOtherTestLead, activityJob, now) ||
		s.canSendOwnerTest(localOwnerTestRecipient, ownerTestLead, activityOtherJob, now) ||
		s.canSendOwnerTest("5511999999999", ownerTestLead, activityJob, now) ||
		s.canSendOwnerTest(localOwnerTestRecipient, ownerTestLead, activityJob, now.Add(31*time.Second)) ||
		s.canSendOwnerTest(localOwnerTestRecipient, ownerTestLead, activityJob, now.Add(-time.Second)) {
		t.Fatal("an authorization is limited to its exact pair and thirty-second lease")
	}
	s.authorizeOwnerTest(localOwnerTestRecipient, ownerTestLead, activityJob, localOwnerTestExpiresAt.Add(-time.Second))
	if s.canSendOwnerTest(localOwnerTestRecipient, ownerTestLead, activityJob, localOwnerTestExpiresAt) {
		t.Fatal("the absolute test deadline also applies to an earlier authorization")
	}
	s.authorizeOwnerTest(localOwnerTestRecipient, ownerTestLead, activityJob, now)
	s.invalidate()
	if s.canSendOwnerTest(localOwnerTestRecipient, ownerTestLead, activityJob, now.Add(time.Second)) {
		t.Fatal("disconnect must revoke all in-memory owner test authorizations")
	}
}

func TestOwnerTestMessageMetadataStillBlocksOtherNormalJobs(t *testing.T) {
	s, ids, now := activityFixture(t)
	s.record(ids, "owner-test-sdk-id", activityJob, now.Add(-time.Second))
	if decision := s.decision(ids, activityOtherJob, 5, now); decision.Allowed || decision.Code != "inactivity_recent" || decision.Activity.LastInteractionAt == nil {
		t.Fatal("test messages remain real interactions for every other normal job")
	}
}

func TestOwnerTestActivityEndpointRequiresConnectedWhatsApp(t *testing.T) {
	s, _, _ := activityFixture(t)
	handler, err := newLocalRESTHandler(nil, localTestToken, s)
	if err != nil {
		t.Fatal(err)
	}
	request := localTestRequest(http.MethodPost, "/api/activity-check", `{"recipient":"`+localOwnerTestRecipient+`","jobId":"`+activityJob+`","days":5,"testLeadId":"`+ownerTestLead+`"}`)
	response := localTestRun(t, handler, request, http.StatusOK, "owner_test_denied")
	if strings.Contains(response.Body.String(), `"activity"`) || s.canSendOwnerTest(localOwnerTestRecipient, ownerTestLead, activityJob, ownerTestTime()) {
		t.Fatal("simulation and disconnected bridges cannot authorize owner tests")
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
	if decision.Allowed || decision.Activity.Complete || decision.Code != "historico_em_sincronizacao" {
		t.Fatal("simulation must not prove contact silence")
	}
	if strings.Contains(response.Body.String(), localTestRecipient) || strings.Contains(response.Body.String(), activityJob) {
		t.Fatal("proof must never export contact identifiers")
	}
	for _, body := range []string{`{}`, `{"recipient":"` + localTestRecipient + `","jobId":"` + activityJob + `","days":1}`, `{"recipient":"` + localTestRecipient + `","jobId":"bad","days":5}`} {
		localTestRun(t, handler, localTestRequest(http.MethodPost, "/api/activity-check", body), http.StatusBadRequest, "invalid_payload")
	}
}

func TestActivityCleanRestartRequiresAuthenticatedSessionAndSyncBarrier(t *testing.T) {
	s, ids, now := activityFixture(t)
	var path string
	if err := s.db.QueryRow("SELECT file FROM pragma_database_list WHERE name='main'").Scan(&path); err != nil {
		t.Fatal(err)
	}
	s.sessionHash = s.hash("session", "fixture-device")
	original := s.coverage
	s.closeClean(now)
	reopened, err := newLocalActivityStore(path, localTestToken)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.db.Close()
	reopened.bindSession(s.sessionHash, now.Add(time.Minute))
	if d := reopened.decision(ids, activityJob, 15, now.Add(time.Minute)); d.Allowed || d.Code != "historico_em_sincronizacao" {
		t.Fatalf("checkpoint alone cannot prove completed sync: %+v", d)
	}
	reopened.completeSync(now.Add(2 * time.Minute))
	if !reopened.coverage.Equal(original) {
		t.Fatal("a verified short clean restart must keep the original observation start")
	}
	if !reopened.decision(ids, activityJob, 15, now.Add(2*time.Minute)).Allowed {
		t.Fatal("covered inactivity should survive clean restart")
	}
	// A second graceful restart proves the marker is rewritten, not merely consumed.
	reopened.closeClean(now.Add(2 * time.Minute))
	second, err := newLocalActivityStore(path, localTestToken)
	if err != nil {
		t.Fatal(err)
	}
	defer second.db.Close()
	second.bindSession(s.sessionHash, now.Add(3*time.Minute))
	second.completeSync(now.Add(3 * time.Minute))
	if !second.coverage.Equal(original) || !second.decision(ids, activityJob, 15, now.Add(3*time.Minute)).Allowed {
		t.Fatal("two clean restarts must preserve the same proof")
	}
}

func TestActivitySameProcessReconnectRequiresCompletionAndKeepsKnownInteractions(t *testing.T) {
	s, ids, now := activityFixture(t)
	original := s.coverage
	s.pause(now)
	if d := s.decision(ids, activityJob, 5, now); d.Allowed || d.Code != "historico_em_sincronizacao" {
		t.Fatal("offline period must deny sends")
	}
	s.record(ids, "queued-during-offline", "", now.Add(time.Second))
	s.completeSync(now.Add(time.Minute))
	d := s.decision(ids, activityJob, 5, now.Add(time.Minute))
	if !s.coverage.Equal(original) || d.Allowed || d.Code != "inactivity_recent" || !d.Activity.Complete {
		t.Fatal("backlog interaction must survive a restored coverage checkpoint")
	}
}

func TestActivityDirtyShutdownStaleCheckpointAndDifferentSessionStartFresh(t *testing.T) {
	for _, kind := range []string{"dirty", "stale", "different-session", "backwards"} {
		t.Run(kind, func(t *testing.T) {
			s, ids, now := activityFixture(t)
			var path string
			s.db.QueryRow("SELECT file FROM pragma_database_list WHERE name='main'").Scan(&path)
			s.sessionHash = s.hash("session", "fixture-device")
			s.heartbeat(now)
			if kind != "dirty" {
				s.closeClean(now)
			} else {
				s.db.Close()
			}
			reopened, err := newLocalActivityStore(path, localTestToken)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.db.Close()
			at := now.Add(time.Minute)
			binding := s.sessionHash
			if kind == "stale" {
				at = now.Add(localActivityMaxOffline + time.Second)
			}
			if kind == "backwards" {
				at = now.Add(-time.Minute)
			}
			if kind == "different-session" {
				binding = reopened.hash("session", "another-device")
			}
			reopened.bindSession(binding, at)
			reopened.completeSync(at)
			if d := reopened.decision(ids, activityJob, 5, at); d.Allowed || d.Code != "historico_incompleto" || !reopened.coverage.Equal(at) {
				t.Fatalf("unverified old proof must start fresh: %+v", d)
			}
		})
	}
}

func TestActivitySignedCheckpointTamperingAndSecretRotationFailClosed(t *testing.T) {
	for _, kind := range []string{"timestamp", "signature", "version", "secret"} {
		t.Run(kind, func(t *testing.T) {
			s, ids, now := activityFixture(t)
			var path string
			s.db.QueryRow("SELECT file FROM pragma_database_list WHERE name='main'").Scan(&path)
			s.sessionHash = s.hash("session", "fixture-device")
			s.checkpointLocked(now, true)
			if kind == "timestamp" {
				s.db.Exec("UPDATE activity_checkpoint SET coverage_start=coverage_start-1")
			}
			if kind == "signature" {
				s.db.Exec("UPDATE activity_checkpoint SET signature='bad'")
			}
			if kind == "version" {
				s.db.Exec("UPDATE activity_checkpoint SET version=2")
			}
			s.db.Close()
			secret := localTestToken
			if kind == "secret" {
				secret = strings.Repeat("x", 64)
			}
			reopened, err := newLocalActivityStore(path, secret)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.db.Close()
			reopened.bindSession(s.sessionHash, now.Add(time.Minute))
			reopened.completeSync(now.Add(time.Minute))
			if d := reopened.decision(ids, activityJob, 5, now.Add(time.Minute)); d.Allowed || d.Code != "historico_indisponivel" {
				t.Fatalf("modified checkpoint cannot establish proof: %+v", d)
			}
		})
	}
}

func TestActivityStartupConsumesCleanMarkerBeforeAnyEvent(t *testing.T) {
	s, _, now := activityFixture(t)
	var path string
	s.db.QueryRow("SELECT file FROM pragma_database_list WHERE name='main'").Scan(&path)
	s.sessionHash = s.hash("session", "fixture-device")
	s.closeClean(now)
	reopened, err := newLocalActivityStore(path, localTestToken)
	if err != nil {
		t.Fatal(err)
	}
	reopened.bindSession(s.sessionHash, now.Add(time.Minute))
	reopened.db.Close()
	crashed, err := newLocalActivityStore(path, localTestToken)
	if err != nil {
		t.Fatal(err)
	}
	defer crashed.db.Close()
	crashed.bindSession(s.sessionHash, now.Add(2*time.Minute))
	crashed.completeSync(now.Add(2 * time.Minute))
	if !crashed.coverage.Equal(now.Add(2 * time.Minute)) {
		t.Fatal("crash after loading a clean checkpoint cannot replay its proof")
	}
}

func TestActivityLegacyRowsAndHistorySyncNeverInventCoverage(t *testing.T) {
	s, ids, now := activityFixture(t)
	s.record(ids, "historical-legacy-row", "", now.Add(-10*24*time.Hour))
	s.coverage = time.Time{}
	s.healthy = false
	s.sessionHash = ""
	s.bindSession(s.hash("session", "fixture-device"), now)
	original := localActivityRecorder
	localActivityRecorder = s
	defer func() { localActivityRecorder = original }()
	recordLocalActivityEvent(nil, &events.HistorySync{})
	if d := s.decision(ids, activityJob, 5, now); d.Allowed || d.Code != "historico_em_sincronizacao" {
		t.Fatal("history blob is not a temporal completeness guarantee")
	}
	s.completeSync(now)
	if d := s.decision(ids, activityJob, 5, now); d.Allowed || d.Code != "historico_incompleto" {
		t.Fatal("legacy activity rows cannot backdate initial coverage")
	}
}

func TestActivityFailureSignalsCannotRestoreOldCoverage(t *testing.T) {
	for _, marker := range []string{"Handler queue is full, message ordering is no longer guaranteed", "Continuing handling of %s in background as it's taking too long", "Closing handler queue loop in the middle of handling %s", "Handler queue wait channel not closed after 5 seconds", "Failed to parse message: %v", "Failed to decompress frame: %v", "Event handler panicked while handling a %T: %v"} {
		t.Run(marker, func(t *testing.T) {
			s, ids, now := activityFixture(t)
			s.pause(now)
			logger := localActivityLogger{waLog.Noop, s}
			logger.Warnf(marker, "fixture")
			s.completeSync(time.Now())
			if s.decision(ids, activityJob, 5, time.Now()).Allowed {
				t.Fatal("an incomplete SDK event stream cannot restore old proof")
			}
		})
	}
}

func TestActivityReplayWithoutDurableMetadataResetsButKnownReplayDoesNot(t *testing.T) {
	s, ids, now := activityFixture(t)
	logger := localActivityLogger{waLog.Noop, s}
	s.record(ids, "known-message", "", now.Add(-6*24*time.Hour))
	original := s.coverage
	logger.Debugf("Ignoring message %s from %s: %v", "known-message", ids[0].String(), "already processed")
	if !s.coverage.Equal(original) {
		t.Fatal("known durable duplicates must not restart observation")
	}
	logger.Debugf("Ignoring message %s from %s: %v", "unknown-message", ids[0].String(), "already processed")
	if s.decision(ids, activityJob, 5, time.Now()).Allowed {
		t.Fatal("crypto dedup without durable metadata leaves a coverage gap")
	}
}

func TestActivityRecentInteractionReportedWhileWindowIsIncomplete(t *testing.T) {
	s, ids, now := activityFixture(t)
	s.beginCoverage(now)
	s.record(ids, "recent-while-warming", "", now.Add(-time.Hour))
	d := s.decision(ids, activityJob, 5, now)
	if d.Allowed || d.Code != "inactivity_recent" || d.Activity.Complete || d.Activity.LastInteractionAt == nil {
		t.Fatal("report known recent interaction without fabricating full coverage")
	}
}

func TestActivityGroupReplayDoesNotResetIndividualCoverage(t *testing.T) {
	s, _, _ := activityFixture(t)
	original := s.coverage
	logger := localActivityLogger{waLog.Noop, s}
	logger.Debugf("Ignoring message %s from %s: %v", "unknown-group-message", "sender@s.whatsapp.net in group@g.us", "already processed")
	if !s.coverage.Equal(original) {
		t.Fatal("nonindividual duplicate replay is outside the inactivity gate")
	}
}

func TestActivityStorageFailureIsStickyThroughSyncAndHeartbeat(t *testing.T) {
	s, ids, now := activityFixture(t)
	s.db.Exec("DROP TABLE activity")
	s.record(ids, "storage-failure", "", now)
	s.completeSync(now)
	s.heartbeat(now)
	if d := s.decision(ids, activityJob, 5, now); d.Allowed || d.Code != "historico_indisponivel" {
		t.Fatal("a later sync marker must never clear a durable recording failure")
	}
}

func TestActivityClockRollbackInvalidatesRememberedReconnectCandidate(t *testing.T) {
	s, ids, now := activityFixture(t)
	s.pause(now)
	s.heartbeat(now.Add(-time.Minute))
	s.completeSync(now.Add(time.Minute))
	if s.decision(ids, activityJob, 5, now.Add(time.Minute)).Allowed {
		t.Fatal("a clock rollback must invalidate a pending reconnect candidate")
	}
}

func TestActivityUnknownCallCannotResumeEarlierCoverage(t *testing.T) {
	s, ids, now := activityFixture(t)
	s.pause(now)
	original := localActivityRecorder
	localActivityRecorder = s
	defer func() { localActivityRecorder = original }()
	recordLocalActivityEvent(nil, &events.UnknownCallEvent{})
	s.completeSync(now.Add(time.Minute))
	if s.decision(ids, activityJob, 5, now.Add(time.Minute)).Allowed {
		t.Fatal("unassignable interaction cannot inherit the earlier window")
	}
}

func TestActivityReplayProofIsBoundToTheExactContact(t *testing.T) {
	s, ids, now := activityFixture(t)
	s.record(ids, "colliding-id", "", now.Add(-6*24*time.Hour))
	logger := localActivityLogger{waLog.Noop, s}
	logger.Debugf("Ignoring message %s from %s: %v", "colliding-id", "5511999999999@s.whatsapp.net", "already processed")
	if s.decision(ids, activityJob, 5, time.Now()).Allowed {
		t.Fatal("a matching message ID in another chat is not metadata proof for this replay")
	}
}

func TestActivityDelayedConnectedDoesNotEraseCompletedSync(t *testing.T) {
	s, ids, now := activityFixture(t)
	deviceID := types.NewJID("fixture-device", types.DefaultUserServer)
	publicKey := [32]byte{1, 2, 3}
	client := whatsmeow.NewClient(&store.Device{ID: &deviceID, IdentityKey: &keys.KeyPair{Pub: &publicKey}, RegistrationID: 42}, waLog.Noop)
	s.sessionHash = localSessionBinding(client, s)
	s.pause(now)
	original := s.candidateCoverage
	originalRecorder := localActivityRecorder
	localActivityRecorder = s
	defer func() { localActivityRecorder = originalRecorder }()
	recordLocalActivityEvent(client, &events.OfflineSyncCompleted{})
	recordLocalActivityEvent(client, &events.Connected{})
	if !s.healthy || !s.coverage.Equal(original) || !s.decision(ids, activityJob, 5, time.Now()).Allowed {
		t.Fatal("a delayed Connected callback cannot erase a completed backlog barrier")
	}
}

func TestActivitySynchronousTransportPausePrecedesAsyncEvents(t *testing.T) {
	s, ids, now := activityFixture(t)
	logger := localActivityLogger{waLog.Noop, s}
	original := s.coverage
	logger.Debugf("Emitting Disconnected event")
	if s.healthy || s.decision(ids, activityJob, 5, now).Allowed {
		t.Fatal("transport loss must block before the asynchronous event runs")
	}
	logger.Debugf("Automatically reconnecting after %v", time.Second)
	s.completeSync(now.Add(time.Minute))
	if !s.healthy || !s.coverage.Equal(original) {
		t.Fatal("a completed bounded reconnect must preserve observation")
	}
}

func TestActivityMissingLedgerCannotBecomeAnEmptyCoveredHistory(t *testing.T) {
	s, _, now := activityFixture(t)
	var path string
	s.db.QueryRow("SELECT file FROM pragma_database_list WHERE name='main'").Scan(&path)
	s.sessionHash = s.hash("session", "fixture-device")
	s.checkpointLocked(now, true)
	s.db.Exec("DROP TABLE activity")
	s.db.Close()
	reopened, err := newLocalActivityStore(path, localTestToken)
	if err == nil {
		reopened.db.Close()
		t.Fatal("a checkpoint without its original ledger cannot assert empty activity")
	}
}
