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
	"path/filepath"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

type localActivityProof struct {
	CheckedAt         time.Time  `json:"checkedAt"`
	CoverageStartedAt time.Time  `json:"coverageStartedAt"`
	LastInteractionAt *time.Time `json:"lastInteractionAt"`
	Complete          bool       `json:"complete"`
}

type localActivityDecision struct {
	Allowed  bool               `json:"allowed"`
	Code     string             `json:"code"`
	Activity localActivityProof `json:"activity"`
}

type localActivityStore struct {
	mu             sync.Mutex
	db             *sql.DB
	secret         []byte
	coverage       time.Time
	healthy        bool
	broken         bool
	lastCheck      time.Time
	authorizations map[string]localActivityAuthorization
}

type localActivityAuthorization struct {
	days      int
	checkedAt time.Time
}

var localActivityRecorder *localActivityStore

func newLocalActivityStore(path, secret string) (*localActivityStore, error) {
	if len(secret) < 32 {
		return nil, errors.New("invalid activity configuration")
	}
	db, err := sql.Open("sqlite3", "file:"+filepath.ToSlash(path)+"?_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS activity (
		contact_hash TEXT NOT NULL, event_hash TEXT NOT NULL,
		job_hash TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL,
		PRIMARY KEY(contact_hash,event_hash)
	); CREATE INDEX IF NOT EXISTS activity_contact_time ON activity(contact_hash,at);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	// Coverage intentionally is not restored from disk: without a verified history
	// bootstrap, a restart/disconnect cannot prove silence during the missing time.
	return &localActivityStore{db: db, secret: []byte(secret), authorizations: make(map[string]localActivityAuthorization)}, nil
}

func (s *localActivityStore) hash(kind, value string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(kind + "\x00" + value))
	return hex.EncodeToString(mac.Sum(nil))
}

func localIndividualJID(jid types.JID) bool {
	return !jid.IsEmpty() && (jid.Server == types.DefaultUserServer || jid.Server == types.HiddenUserServer)
}

func (s *localActivityStore) invalidate() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.healthy = false
	s.coverage = time.Time{}
}

func (s *localActivityStore) beginCoverage(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.broken {
		s.coverage = now
		s.healthy = true
		s.lastCheck = now
	}
}

func (s *localActivityStore) record(jids []types.JID, id, jobID string, at time.Time) {
	if len(jids) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if at.IsZero() || id == "" {
		s.broken = true
		s.healthy = false
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
			s.broken = true
			s.healthy = false
			return
		}
	}
	// Windows are at most 15 days. Retain one additional day for boundary checks.
	if _, err := s.db.Exec("DELETE FROM activity WHERE at < ?", time.Now().Add(-16*24*time.Hour).UnixMilli()); err != nil {
		s.broken = true
		s.healthy = false
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

func recordLocalActivityEvent(_ *whatsmeow.Client, evt interface{}) {
	s := localActivityRecorder
	if s == nil {
		return
	}
	switch value := evt.(type) {
	case *events.Connected:
		s.invalidate() // wait until the offline backlog has been processed
	case *events.OfflineSyncCompleted:
		s.beginCoverage(time.Now())
	case *events.Disconnected, *events.KeepAliveTimeout, *events.OfflineSyncPreview, *events.StreamError:
		s.invalidate()
	case *events.KeepAliveRestored:
		// A keepalive gap is deliberately not bridged by an unverified timestamp.
		s.beginCoverage(time.Now())
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
		s.invalidate() // cannot assign an unknown interaction to a contact
	}
}

func (s *localActivityStore) decision(keys []types.JID, jobID string, days int, now time.Time) localActivityDecision {
	s.mu.Lock()
	defer s.mu.Unlock()
	// A suspended Mac or clock jump leaves no trustworthy observation coverage.
	if !s.lastCheck.IsZero() && (now.UTC().Sub(s.lastCheck.UTC()) > 2*time.Minute || now.Before(s.lastCheck)) {
		s.coverage = now
	}
	s.lastCheck = now
	proof := localActivityProof{CheckedAt: now, CoverageStartedAt: s.coverage}
	denied := func(code string) localActivityDecision { return localActivityDecision{Code: code, Activity: proof} }
	if !s.healthy || s.broken || s.coverage.IsZero() || len(keys) < 2 || (days != 5 && days != 15) {
		return denied("inactivity_unverified")
	}
	cutoff := now.Add(-time.Duration(days) * 24 * time.Hour)
	if s.coverage.After(cutoff) {
		return denied("inactivity_unverified")
	}
	proof.Complete = true
	for _, jid := range keys {
		if !localIndividualJID(jid) {
			proof.Complete = false
			return denied("inactivity_unverified")
		}
		var last sql.NullInt64
		err := s.db.QueryRow("SELECT MAX(at) FROM activity WHERE contact_hash=? AND job_hash!=?", s.hash("contact", jid.ToNonAD().String()), s.hash("job", jobID)).Scan(&last)
		if err != nil {
			s.broken = true
			proof.Complete = false
			return denied("inactivity_unverified")
		}
		if last.Valid {
			at := time.UnixMilli(last.Int64).UTC()
			if proof.LastInteractionAt == nil || at.After(*proof.LastInteractionAt) {
				proof.LastInteractionAt = &at
			}
		}
	}
	if proof.LastInteractionAt != nil && proof.LastInteractionAt.After(cutoff) {
		return denied("inactivity_recent")
	}
	for key, authorization := range s.authorizations {
		if now.Sub(authorization.checkedAt) > 30*time.Second {
			delete(s.authorizations, key)
		}
	}
	s.authorizations[s.hash("job", jobID)] = localActivityAuthorization{days: days, checkedAt: now}
	return localActivityDecision{Allowed: true, Code: "inactivity_clear", Activity: proof}
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
	if s.healthy && !s.lastCheck.IsZero() && (now.UTC().Sub(s.lastCheck.UTC()) > 2*time.Minute || now.Before(s.lastCheck)) {
		s.coverage = now
	}
	s.lastCheck = now
}

func startLocalActivityRecorder(client *whatsmeow.Client, secret string) (func(), error) {
	store, err := newLocalActivityStore("store/activity.db", secret)
	if err != nil {
		return nil, err
	}
	localActivityRecorder = store
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
	return func() { close(stop); <-done; localActivityRecorder = nil; store.db.Close() }, nil
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
