package main

// Only contact/message/job hashes and timestamps are stored. Message bodies,
// contact names, media and conversation history never enter this database.
import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type localActivityProof struct {
	CheckedAt         time.Time  `json:"checkedAt"`
	CoverageStartedAt time.Time  `json:"coverageStartedAt"`
	LastInteractionAt *time.Time `json:"lastInteractionAt"`
	Complete          bool       `json:"complete"`
}

type localActivityDecision struct {
	Allowed    bool                `json:"allowed"`
	Code       string              `json:"code"`
	Activity   *localActivityProof `json:"activity,omitempty"`
	TestLeadID string              `json:"testLeadId,omitempty"`
	JobID      string              `json:"jobId,omitempty"`
	Recipient  string              `json:"recipient,omitempty"`
	CheckedAt  *time.Time          `json:"checkedAt,omitempty"`
}

type localActivityStore struct {
	mu                      sync.Mutex
	db                      *sql.DB
	secret                  []byte
	coverage                time.Time
	healthy                 bool
	closed                  bool
	sessionHash             string
	candidateCoverage       time.Time
	candidateAt             time.Time
	broken                  bool
	lastCheck               time.Time
	authorizations          map[string]localActivityAuthorization
	ownerTestAuthorizations map[string]localOwnerTestAuthorization
}

type localActivityAuthorization struct {
	days      int
	checkedAt time.Time
}

type localOwnerTestAuthorization struct {
	leadHash      string
	recipientHash string
	checkedAt     time.Time
}

// Henrique explicitly authorized immediate receipt tests for these five cards.
// This short-lived exception is independent of, and never fabricates, observed
// inactivity. It cannot authorize another number, card, or a real-client job.
const localOwnerTestRecipient = "5519988763916"

var localOwnerTestExpiresAt = time.Date(2026, time.October, 17, 18, 0, 0, 0, time.UTC)

func validLocalOwnerTest(recipient, leadID string, now time.Time) bool {
	if recipient != localOwnerTestRecipient || !now.Before(localOwnerTestExpiresAt) {
		return false
	}
	switch leadID {
	case "01b985e2-6bff-4e9c-bb5e-2f1cc280edf7",
		"d459193f-9e7c-4b2c-995d-7f829a0936bd",
		"13e49741-9d35-404c-ae54-42fe93e55c66",
		"abf88ff2-ea34-4e32-994d-f7dc75df599b",
		"9263d823-d059-4e0a-b759-9184035dec89":
		return true
	default:
		return false
	}
}

func (s *localActivityStore) authorizeOwnerTest(recipient, leadID, jobID string, now time.Time) localActivityDecision {
	denied := localActivityDecision{Code: "owner_test_denied"}
	if !validLocalOwnerTest(recipient, leadID, now) || !validLocalJobID(jobID) {
		return denied
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, authorization := range s.ownerTestAuthorizations {
		if now.Before(authorization.checkedAt) || now.Sub(authorization.checkedAt) > 30*time.Second {
			delete(s.ownerTestAuthorizations, key)
		}
	}
	s.ownerTestAuthorizations[s.hash("job", jobID)] = localOwnerTestAuthorization{
		leadHash: s.hash("lead", leadID), recipientHash: s.hash("recipient", recipient), checkedAt: now,
	}
	return localActivityDecision{Allowed: true, Code: "owner_test_authorized", TestLeadID: leadID, JobID: jobID, Recipient: recipient, CheckedAt: &now}
}

func (s *localActivityStore) canSendOwnerTest(recipient, leadID, jobID string, now time.Time) bool {
	if !validLocalOwnerTest(recipient, leadID, now) || !validLocalJobID(jobID) {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	authorization, found := s.ownerTestAuthorizations[s.hash("job", jobID)]
	return found && !now.Before(authorization.checkedAt) && now.Sub(authorization.checkedAt) <= 30*time.Second &&
		authorization.leadHash == s.hash("lead", leadID) && authorization.recipientHash == s.hash("recipient", recipient)
}

var localActivityRecorder *localActivityStore

func newLocalActivityStore(path, secret string) (*localActivityStore, error) {
	if len(secret) < 32 {
		return nil, errors.New("invalid activity configuration")
	}
	db, err := sql.Open("sqlite3", "file:"+filepath.ToSlash(path)+"?_busy_timeout=5000&_synchronous=FULL&_journal_mode=WAL")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	// A checkpoint without its original activity ledger is not an empty chat.
	// Never silently recreate a missing ledger and reuse its signed proof.
	var ledgerExists, checkpointExists int
	if err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='activity'), EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='activity_checkpoint')").Scan(&ledgerExists, &checkpointExists); err != nil || (checkpointExists == 1 && ledgerExists != 1) {
		db.Close()
		return nil, errors.New("activity ledger unavailable")
	}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS activity (
		contact_hash TEXT NOT NULL, event_hash TEXT NOT NULL,
		job_hash TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL,
		PRIMARY KEY(contact_hash,event_hash)
	); CREATE INDEX IF NOT EXISTS activity_contact_time ON activity(contact_hash,at);
	CREATE TABLE IF NOT EXISTS activity_checkpoint (
		id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, session_hash TEXT NOT NULL,
		coverage_start INTEGER NOT NULL, checkpoint_at INTEGER NOT NULL, clean_shutdown INTEGER NOT NULL, signature TEXT NOT NULL
	);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	// Restoring a checkpoint is deferred until the authenticated session and its
	// offline-sync completion have both been verified. Legacy rows prove no silence.
	return &localActivityStore{db: db, secret: []byte(secret), authorizations: make(map[string]localActivityAuthorization), ownerTestAuthorizations: make(map[string]localOwnerTestAuthorization)}, nil
}

func (s *localActivityStore) hash(kind, value string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(kind + "\x00" + value))
	return hex.EncodeToString(mac.Sum(nil))
}

func localIndividualJID(jid types.JID) bool {
	return !jid.IsEmpty() && (jid.Server == types.DefaultUserServer || jid.Server == types.HiddenUserServer)
}

// The SDK supplies a backlog-completed marker but no retention SLA. Thirty
// minutes is our conservative maximum reconnection policy, not a WhatsApp SLA.
const localActivityMaxOffline = 30 * time.Minute

func (s *localActivityStore) checkpointSignature(session string, start, at int64, clean int) string {
	return s.hash("checkpoint", fmt.Sprintf("1|%s|%d|%d|%d", session, start, at, clean))
}

func (s *localActivityStore) failLocked() {
	s.broken = true
	s.healthy = false
	s.candidateCoverage = time.Time{}
	s.candidateAt = time.Time{}
	clear(s.authorizations)
	clear(s.ownerTestAuthorizations)
	// A failed checkpoint cannot later be mistaken for a clean shutdown.
	_, _ = s.db.Exec("DELETE FROM activity_checkpoint WHERE id=1")
}

func (s *localActivityStore) checkpointLocked(now time.Time, clean bool) bool {
	if s.sessionHash == "" || s.coverage.IsZero() || s.closed {
		return false
	}
	value := 0
	if clean {
		value = 1
	}
	start, at := s.coverage.UnixMilli(), now.UnixMilli()
	_, err := s.db.Exec(`INSERT INTO activity_checkpoint(id,version,session_hash,coverage_start,checkpoint_at,clean_shutdown,signature)
		VALUES(1,1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,session_hash=excluded.session_hash,
		coverage_start=excluded.coverage_start,checkpoint_at=excluded.checkpoint_at,clean_shutdown=excluded.clean_shutdown,signature=excluded.signature`,
		s.sessionHash, start, at, value, s.checkpointSignature(s.sessionHash, start, at, value))
	if err != nil {
		s.failLocked()
		return false
	}
	return true
}

// bindSession only accepts authenticated device identifiers. A different device,
// key rotation, dirty exit, invalid signature or stale checkpoint starts afresh.
func (s *localActivityStore) bindSession(binding string, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.broken || s.closed || binding == "" {
		return
	}
	if s.sessionHash == binding {
		return
	}
	s.coverage = time.Time{}
	s.candidateCoverage, s.candidateAt = time.Time{}, time.Time{}
	s.healthy = false
	s.sessionHash = binding
	var version, clean int
	var session, signature string
	var start, at int64
	err := s.db.QueryRow("SELECT version,session_hash,coverage_start,checkpoint_at,clean_shutdown,signature FROM activity_checkpoint WHERE id=1").Scan(&version, &session, &start, &at, &clean, &signature)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		s.failLocked()
		return
	}
	if err == nil {
		validSignature := hmac.Equal([]byte(signature), []byte(s.checkpointSignature(session, start, at, clean)))
		if !validSignature || version != 1 || (clean != 0 && clean != 1) || start <= 0 || at < start {
			s.failLocked()
			return
		}
		checkpointAt := time.UnixMilli(at).UTC()
		if session == binding && clean == 1 && !now.Before(checkpointAt) && now.Sub(checkpointAt) <= localActivityMaxOffline {
			s.candidateCoverage, s.candidateAt = time.UnixMilli(start).UTC(), checkpointAt
		}
	}
	// Consume the clean marker before processing any new event. A crash from this
	// point cannot reuse the old proof, even if crypto dedup suppresses a replay.
	if _, err := s.db.Exec("DELETE FROM activity_checkpoint WHERE id=1"); err != nil {
		s.failLocked()
	}
}

func localSessionBinding(client *whatsmeow.Client, s *localActivityStore) string {
	if client == nil || client.Store == nil || client.Store.ID == nil || client.Store.IdentityKey == nil || client.Store.IdentityKey.Pub == nil {
		return ""
	}
	return s.hash("session", fmt.Sprintf("%s|%x|%d", client.Store.ID.String(), client.Store.IdentityKey.Pub[:], client.Store.RegistrationID))
}

func (s *localActivityStore) pause(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if s.healthy && !s.broken && !s.coverage.IsZero() && !now.Before(s.lastCheck) && now.Sub(s.lastCheck) <= 2*time.Minute {
		s.candidateCoverage, s.candidateAt = s.coverage, s.lastCheck
	}
	s.healthy = false
	clear(s.authorizations)
	clear(s.ownerTestAuthorizations)
}

func (s *localActivityStore) invalidate() { s.pause(time.Now()) }

func (s *localActivityStore) beginCoverage(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.broken && !s.closed {
		s.coverage = now
		s.healthy = true
		s.lastCheck = now
	}
}

func (s *localActivityStore) completeSync(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.broken || s.closed {
		return
	}
	s.coverage = now
	if !s.candidateCoverage.IsZero() && !s.candidateAt.IsZero() && !now.Before(s.candidateAt) && now.Sub(s.candidateAt) <= localActivityMaxOffline {
		s.coverage = s.candidateCoverage
	}
	s.candidateCoverage, s.candidateAt = time.Time{}, time.Time{}
	s.healthy, s.lastCheck = true, now
	s.checkpointLocked(now, false)
}

// An unassignable event, ordering loss or clock discontinuity cannot be bridged.
// A new observation window is safe; it never asserts silence in the missing part.
func (s *localActivityStore) breakContinuity(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.candidateCoverage, s.candidateAt = time.Time{}, time.Time{}
	s.coverage, s.lastCheck = now, now
	clear(s.authorizations)
	clear(s.ownerTestAuthorizations)
	if s.sessionHash != "" {
		s.checkpointLocked(now, false)
	}
}

func (s *localActivityStore) closeClean(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if s.healthy && !s.broken && !s.lastCheck.IsZero() && !now.Before(s.lastCheck) && now.Sub(s.lastCheck) <= 2*time.Minute {
		s.checkpointLocked(now, true)
	}
	s.closed, s.healthy = true, false
	clear(s.authorizations)
	clear(s.ownerTestAuthorizations)
	s.db.Close()
}

// SDK logs are also control signals: parse/order/decryption failures that do not
// emit metadata must invalidate proof, without persisting a message or identifier.
type localActivityLogger struct {
	base     waLog.Logger
	activity *localActivityStore
}

func (l localActivityLogger) inspect(format string, args ...any) {
	// These SDK calls run synchronously before its asynchronous lifecycle events
	// and before reconnect starts. They establish the transport pause even if an
	// old Connected/Disconnected callback arrives after the new sync barrier.
	for _, marker := range []string{"Emitting Disconnected event", "Automatically reconnecting after", "Keepalive timed out", "Failed to send keepalive"} {
		if strings.HasPrefix(format, marker) {
			l.activity.pause(time.Now())
			return
		}
	}
	for _, marker := range []string{"Handler queue is full", "Continuing handling of", "Closing handler queue loop in the middle", "Handler queue wait channel not closed", "Failed to parse message", "Failed to decompress frame", "Failed to decode node", "Unknown version", "Unknown type of message", "Unhandled encrypted message", "Error unmarshaling decrypted message", "Message decryption for", "Event handler panicked"} {
		if strings.Contains(format, marker) {
			l.activity.breakContinuity(time.Now())
			return
		}
	}
	if strings.HasPrefix(format, "Ignoring message") && len(args) > 0 {
		// SourceString is pinned SDK metadata (chat, or sender + " in " + chat).
		// It identifies the chat without decrypting or storing conversation text.
		var chat types.JID
		if len(args) > 1 {
			source := strings.Split(fmt.Sprint(args[1]), " in ")
			if jid, err := types.ParseJID(source[len(source)-1]); err == nil {
				chat = jid
			}
		}
		if !chat.IsEmpty() && !localIndividualJID(chat) {
			return
		}
		if chat.IsEmpty() {
			l.activity.breakContinuity(time.Now())
			return
		}
		l.activity.mu.Lock()
		if l.activity.closed {
			l.activity.mu.Unlock()
			return
		}
		var exists int
		err := l.activity.db.QueryRow("SELECT EXISTS(SELECT 1 FROM activity WHERE contact_hash=? AND event_hash=?)", l.activity.hash("contact", chat.ToNonAD().String()), l.activity.hash("event", fmt.Sprint(args[0]))).Scan(&exists)
		l.activity.mu.Unlock()
		if err != nil || exists != 1 {
			l.activity.breakContinuity(time.Now())
		}
	}
}
func (l localActivityLogger) Warnf(f string, a ...any)  { l.inspect(f, a...); l.base.Warnf(f, a...) }
func (l localActivityLogger) Errorf(f string, a ...any) { l.inspect(f, a...); l.base.Errorf(f, a...) }
func (l localActivityLogger) Infof(f string, a ...any)  { l.base.Infof(f, a...) }
func (l localActivityLogger) Debugf(f string, a ...any) { l.inspect(f, a...); l.base.Debugf(f, a...) }
func (l localActivityLogger) Sub(module string) waLog.Logger {
	return localActivityLogger{l.base.Sub(module), l.activity}
}

func (s *localActivityStore) record(jids []types.JID, id, jobID string, at time.Time) {
	if len(jids) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if at.IsZero() || id == "" {
		s.failLocked()
		return
	}
	for _, jid := range jids {
		if !localIndividualJID(jid) {
			continue
		}
		jobHash := ""
		if jobID != "" {
			jobHash = s.hash("job", jobID)
		}
		_, err := s.db.Exec(`INSERT INTO activity(contact_hash,event_hash,job_hash,at) VALUES(?,?,?,?)
			ON CONFLICT(contact_hash,event_hash) DO UPDATE SET
			at=MAX(activity.at,excluded.at),
			job_hash=CASE WHEN excluded.job_hash!='' THEN excluded.job_hash ELSE activity.job_hash END`,
			s.hash("contact", jid.ToNonAD().String()), s.hash("event", id), jobHash, at.UnixMilli())
		if err != nil {
			s.failLocked()
			return
		}
	}
	// Windows are at most 15 days. Retain one additional day for boundary checks.
	if _, err := s.db.Exec("DELETE FROM activity WHERE at < ?", time.Now().Add(-16*24*time.Hour).UnixMilli()); err != nil {
		s.failLocked()
	}
}

func localMessageJIDs(info types.MessageInfo) []types.JID {
	if info.IsGroup || !localIndividualJID(info.Chat) {
		return nil
	}
	ids := []types.JID{info.Chat}
	// For own-device messages SenderAlt identifies Mel, not the other person.
	if info.IsFromMe {
		if localIndividualJID(info.RecipientAlt) {
			ids = append(ids, info.RecipientAlt)
		}
	} else if localIndividualJID(info.SenderAlt) {
		ids = append(ids, info.SenderAlt)
	}
	return ids
}

func recordLocalActivityEvent(client *whatsmeow.Client, evt interface{}) {
	s := localActivityRecorder
	if s == nil {
		return
	}
	switch value := evt.(type) {
	case *events.Connected:
		// The SDK emits Connected asynchronously after prekey setup. It can arrive
		// after OfflineSyncCompleted, and must not erase that newer sync barrier.
		s.bindSession(localSessionBinding(client, s), time.Now())
	case *events.OfflineSyncCompleted:
		s.bindSession(localSessionBinding(client, s), time.Now())
		s.completeSync(time.Now())
	case *events.Disconnected:
		// The synchronous logger already paused at transport loss. Ignore a late
		// callback from the previous socket once a new one is connected.
		if client == nil || !localClientConnected(client) {
			s.invalidate()
		}
	case *events.KeepAliveTimeout:
		// The synchronous ping-failure log establishes the pause; this callback
		// can be delayed and must not erase a newly completed connection sync.
		if client == nil || !localClientConnected(client) {
			s.invalidate()
		}
	case *events.OfflineSyncPreview, *events.StreamError:
		s.invalidate()
	case *events.KeepAliveRestored:
		// Ping restoration alone is no backlog barrier. Reconnect only if a new
		// connection has not already completed the required backlog sync.
		s.mu.Lock()
		waiting := !s.healthy && !s.broken && !s.closed
		s.mu.Unlock()
		if waiting && client != nil {
			go client.ResetConnection()
		}
	case events.PermanentDisconnect:
		s.invalidate()
	case *events.Message:
		s.record(localMessageJIDs(value.Info), string(value.Info.ID), "", value.Info.Timestamp)
	case *events.UndecryptableMessage:
		// The transport metadata is sufficient; decrypting/reading text is unnecessary.
		s.record(localMessageJIDs(value.Info), string(value.Info.ID), "", value.Info.Timestamp)
	case *events.CallOffer:
		s.record([]types.JID{value.From, value.CallCreator, value.CallCreatorAlt}, value.CallID, "", value.Timestamp)
	case *events.CallAccept:
		s.record([]types.JID{value.From, value.CallCreator, value.CallCreatorAlt}, value.CallID, "", value.Timestamp)
	case *events.CallTerminate:
		s.record([]types.JID{value.From, value.CallCreator, value.CallCreatorAlt}, value.CallID, "", value.Timestamp)
	case *events.CallReject:
		s.record([]types.JID{value.From, value.CallCreator, value.CallCreatorAlt}, value.CallID, "", value.Timestamp)
	case *events.UnknownCallEvent:
		s.breakContinuity(time.Now()) // cannot assign an unknown interaction to a contact
	}
}

func (s *localActivityStore) decision(keys []types.JID, jobID string, days int, now time.Time) localActivityDecision {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Clock discontinuities cannot inherit a checkpoint from the old timeline.
	if !s.lastCheck.IsZero() && (now.UTC().Sub(s.lastCheck.UTC()) > 2*time.Minute || now.Before(s.lastCheck)) {
		s.coverage = now
		s.candidateCoverage, s.candidateAt = time.Time{}, time.Time{}
		clear(s.authorizations)
		clear(s.ownerTestAuthorizations)
		s.checkpointLocked(now, false)
	}
	s.lastCheck = now
	proof := localActivityProof{CheckedAt: now, CoverageStartedAt: s.coverage}
	denied := func(code string) localActivityDecision { return localActivityDecision{Code: code, Activity: &proof} }
	if s.broken || s.closed {
		return denied("historico_indisponivel")
	}
	if len(keys) < 2 || (days != 5 && days != 15) {
		return denied("identidade_nao_confirmada")
	}
	cutoff := now.Add(-time.Duration(days) * 24 * time.Hour)
	for _, jid := range keys {
		if !localIndividualJID(jid) {
			return denied("identidade_nao_confirmada")
		}
		var last sql.NullInt64
		err := s.db.QueryRow("SELECT MAX(at) FROM activity WHERE contact_hash=? AND job_hash!=?", s.hash("contact", jid.ToNonAD().String()), s.hash("job", jobID)).Scan(&last)
		if err != nil {
			s.failLocked()
			return denied("historico_indisponivel")
		}
		if last.Valid {
			at := time.UnixMilli(last.Int64).UTC()
			if proof.LastInteractionAt == nil || at.After(*proof.LastInteractionAt) {
				proof.LastInteractionAt = &at
			}
		}
	}
	proof.Complete = s.healthy && !s.coverage.IsZero() && !s.coverage.After(cutoff)
	// A known interaction is useful even while the complete window is warming up.
	if proof.LastInteractionAt != nil && proof.LastInteractionAt.After(cutoff) {
		return denied("inactivity_recent")
	}
	if !s.healthy {
		return denied("historico_em_sincronizacao")
	}
	if !proof.Complete {
		return denied("historico_incompleto")
	}
	for key, authorization := range s.authorizations {
		if now.Sub(authorization.checkedAt) > 30*time.Second {
			delete(s.authorizations, key)
		}
	}
	s.authorizations[s.hash("job", jobID)] = localActivityAuthorization{days: days, checkedAt: now}
	return localActivityDecision{Allowed: true, Code: "inactivity_clear", Activity: &proof}
}

func (s *localActivityStore) canSend(keys []types.JID, jobID string, now time.Time) bool {
	s.mu.Lock()
	authorization, found := s.authorizations[s.hash("job", jobID)]
	s.mu.Unlock()
	if !found || now.Before(authorization.checkedAt) || now.Sub(authorization.checkedAt) > 30*time.Second {
		return false
	}
	// Recheck locally after the cloud started ACK as well. A reply arriving while
	// that network request was in flight must still stop this WhatsApp send.
	return s.decision(keys, jobID, authorization.days, now).Allowed
}

func (s *localActivityStore) heartbeat(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.lastCheck.IsZero() && ((s.healthy && now.UTC().Sub(s.lastCheck.UTC()) > 2*time.Minute) || now.Before(s.lastCheck)) {
		s.coverage = now
		s.candidateCoverage, s.candidateAt = time.Time{}, time.Time{}
		clear(s.authorizations)
		clear(s.ownerTestAuthorizations)
	}
	s.lastCheck = now
	if s.healthy && !s.broken && !s.closed {
		s.checkpointLocked(now, false)
	}
}

func startLocalActivityRecorder(client *whatsmeow.Client, secret string) (func(), error) {
	store, err := newLocalActivityStore("store/activity.db", secret)
	if err != nil {
		return nil, err
	}
	// Consume a clean checkpoint before Connect can acknowledge any new event.
	// If durable consumption fails, starting the transport would leave reusable
	// stale evidence on disk, so this initialization must fail closed.
	if binding := localSessionBinding(client, store); binding != "" {
		store.bindSession(binding, time.Now())
		if store.broken {
			store.db.Close()
			return nil, errors.New("activity checkpoint unavailable")
		}
	}
	localActivityRecorder = store
	client.SynchronousAck = true
	client.Log = localActivityLogger{client.Log, store}
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case now := <-ticker.C:
				if !localClientConnected(client) {
					store.invalidate()
				}
				store.heartbeat(now)
			}
		}
	}()
	return func() {
		close(stop)
		<-done
		// Disconnect waits for SDK handlers; interruption warnings invalidate proof.
		client.Disconnect()
		store.closeClean(time.Now())
		// Keep the closed recorder reachable until process exit: SDK lifecycle
		// callbacks are asynchronous, and must not race a global pointer reset.
	}, nil
}

func localActivityIdentity(ctx context.Context, client *whatsmeow.Client, recipient string) ([]types.JID, error) {
	if client == nil || client.Store == nil || client.Store.LIDs == nil {
		return nil, errors.New("identity unavailable")
	}
	pn := types.NewJID(recipient, types.DefaultUserServer)
	lid, err := client.Store.LIDs.GetLIDForPN(ctx, pn)
	if err != nil || lid.IsEmpty() || lid.Server != types.HiddenUserServer {
		return nil, errors.New("identity unavailable")
	}
	mapped, err := client.Store.LIDs.GetPNForLID(ctx, lid)
	if err != nil || mapped.ToNonAD() != pn {
		return nil, errors.New("identity unavailable")
	}
	return []types.JID{pn, lid}, nil
}
