package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

const localBridgeMaxBodyBytes int64 = 64 * 1024

type localSendRequest struct {
	Recipient       string `json:"recipient"`
	Message         string `json:"message"`
	AutomationJobID string `json:"automation_job_id,omitempty"`
}

type localBridgeResponse struct {
	Success bool   `json:"success"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// The installer copies this file into the pinned upstream package. It never
// exposes the upstream mux, downloads, arbitrary paths or conversation history.
func startLocalRESTServer(client *whatsmeow.Client, _ *MessageStore, port int) {
	handler, err := newLocalRESTHandler(client, os.Getenv("MEL_WHATSAPP_BRIDGE_TOKEN"), localActivityRecorder)
	if err != nil || port < 1 || port > 65535 {
		log.Print("Local WhatsApp bridge configuration is invalid")
		os.Exit(1)
		return
	}

	// Bind synchronously so a collision cannot leave an apparently running bridge.
	listener, err := net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		log.Print("Local WhatsApp bridge could not bind its loopback port")
		os.Exit(1)
		return
	}
	server := newLocalHTTPServer(handler)
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Print("Local WhatsApp bridge server stopped unexpectedly")
			os.Exit(1)
		}
	}()
}

func newLocalHTTPServer(handler http.Handler) *http.Server {
	return &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      35 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}
}

// nil client is a simulation, not an instruction to initialize or pair a client.
func newLocalRESTHandler(client *whatsmeow.Client, token string, activities ...*localActivityStore) (http.Handler, error) {
	if len(token) < 32 {
		return nil, errors.New("local bridge token must contain at least 32 characters")
	}
	for _, character := range token {
		if character < '!' || character > '~' {
			return nil, errors.New("local bridge token must be printable ASCII without spaces")
		}
	}
	expectedToken := sha256.Sum256([]byte(token))
	mux := http.NewServeMux()
	var activity *localActivityStore
	if len(activities) > 0 {
		activity = activities[0]
	}

	mux.HandleFunc("/api/activity-check", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeLocalError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Use POST for the activity check.")
			return
		}
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" {
			writeLocalError(w, http.StatusUnsupportedMediaType, "invalid_content_type", "Use UTF-8 application/json.")
			return
		}
		body := http.MaxBytesReader(w, r.Body, 4096)
		defer body.Close()
		data, err := io.ReadAll(body)
		if err != nil || !utf8.Valid(data) {
			writeLocalError(w, http.StatusBadRequest, "invalid_payload", "Invalid activity payload.")
			return
		}
		var request struct {
			Recipient string `json:"recipient"`
			JobID     string `json:"jobId"`
			Days      int    `json:"days"`
		}
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&request); err != nil {
			writeLocalError(w, http.StatusBadRequest, "invalid_payload", "Invalid activity payload.")
			return
		}
		var extra json.RawMessage
		if err = decoder.Decode(&extra); !errors.Is(err, io.EOF) || !validLocalBrazilRecipient(request.Recipient) || !validLocalJobID(request.JobID) || (request.Days != 5 && request.Days != 15) {
			writeLocalError(w, http.StatusBadRequest, "invalid_payload", "Invalid activity payload.")
			return
		}
		decision := localActivityDecision{Code: "inactivity_unverified", Activity: localActivityProof{CheckedAt: time.Now()}}
		if activity != nil && localClientConnected(client) {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			if keys, err := localActivityIdentity(ctx, client, request.Recipient); err == nil {
				decision = activity.decision(keys, request.JobID, request.Days, time.Now())
			}
		}
		writeLocalJSON(w, http.StatusOK, decision)
	})

	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeLocalError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Use GET for status.")
			return
		}
		writeLocalJSON(w, http.StatusOK, struct {
			Simulation bool `json:"simulation"`
			Connected  bool `json:"connected"`
		}{Simulation: client == nil, Connected: localClientConnected(client)})
	})

	mux.HandleFunc("/api/send", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeLocalError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Use POST for sending.")
			return
		}
		mediaType, parameters, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" ||
			(parameters["charset"] != "" && !strings.EqualFold(parameters["charset"], "utf-8")) {
			writeLocalError(w, http.StatusUnsupportedMediaType, "invalid_content_type", "Use UTF-8 application/json.")
			return
		}

		body := http.MaxBytesReader(w, r.Body, localBridgeMaxBodyBytes)
		defer body.Close()
		data, err := io.ReadAll(body)
		if err != nil {
			var limitError *http.MaxBytesError
			if errors.As(err, &limitError) {
				writeLocalError(w, http.StatusRequestEntityTooLarge, "body_too_large", "Request body exceeds the local limit.")
			} else {
				writeLocalError(w, http.StatusBadRequest, "invalid_payload", "Could not read the request body.")
			}
			return
		}
		// encoding/json replaces malformed UTF-8, so validate the raw bytes first.
		if !utf8.Valid(data) {
			writeLocalError(w, http.StatusBadRequest, "invalid_payload", "Request body must be valid UTF-8 JSON.")
			return
		}
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.DisallowUnknownFields()
		var request localSendRequest
		if err := decoder.Decode(&request); err != nil {
			writeLocalError(w, http.StatusBadRequest, "invalid_payload", "Invalid text message payload.")
			return
		}
		var extra json.RawMessage
		if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
			writeLocalError(w, http.StatusBadRequest, "invalid_payload", "Send exactly one JSON object.")
			return
		}
		if !validLocalBrazilRecipient(request.Recipient) {
			writeLocalError(w, http.StatusBadRequest, "invalid_recipient", "Use a Brazilian individual number with country code and area code, digits only.")
			return
		}
		if strings.TrimSpace(request.Message) == "" || !utf8.ValidString(request.Message) || utf8.RuneCountInString(request.Message) > 4000 {
			writeLocalError(w, http.StatusBadRequest, "invalid_message", "Message must contain 1 to 4000 UTF-8 characters and cannot be blank.")
			return
		}
		if request.AutomationJobID != "" && !validLocalJobID(request.AutomationJobID) {
			writeLocalError(w, http.StatusBadRequest, "invalid_payload", "Invalid automation reference.")
			return
		}
		if client == nil {
			writeLocalError(w, http.StatusOK, "simulation_no_send", "Simulation does not send messages.")
			return
		}
		if !localClientConnected(client) {
			writeLocalError(w, http.StatusServiceUnavailable, "not_connected", "WhatsApp is not connected and authenticated.")
			return
		}
		// Generate the exact SDK ID before sending so an own-device echo can never
		// make a sequence block itself. Only this job's own IDs are excluded later.
		keys := []types.JID{types.NewJID(request.Recipient, types.DefaultUserServer)}
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		if mapped, err := localActivityIdentity(ctx, client, request.Recipient); err == nil {
			keys = mapped
		}
		if request.AutomationJobID != "" && (activity == nil || !activity.canSend(keys, request.AutomationJobID, time.Now())) {
			writeLocalError(w, http.StatusConflict, "inactivity_unverified", "The proposal activity guard did not authorize this send.")
			return
		}
		messageID := client.GenerateMessageID()
		if activity != nil {
			activity.record(keys, string(messageID), request.AutomationJobID, time.Now())
		}
		_, err = client.SendMessage(ctx, keys[0], &waProto.Message{Conversation: proto.String(request.Message)}, whatsmeow.SendRequestExtra{ID: messageID})
		if err != nil {
			writeLocalError(w, http.StatusBadGateway, "send_failed", "Could not confirm message sending. Do not retry automatically.")
			return
		}
		writeLocalJSON(w, http.StatusOK, localBridgeResponse{Success: true, Code: "sent", Message: "Message sent."})
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(r.Header.Values("Origin")) != 0 {
			writeLocalError(w, http.StatusForbidden, "origin_not_allowed", "Browser-origin requests are not allowed.")
			return
		}
		authorization := r.Header.Values("Authorization")
		if len(authorization) != 1 || !strings.HasPrefix(authorization[0], "Bearer ") {
			writeLocalError(w, http.StatusUnauthorized, "unauthorized", "Local bridge authorization required.")
			return
		}
		actualToken := sha256.Sum256([]byte(strings.TrimPrefix(authorization[0], "Bearer ")))
		if subtle.ConstantTimeCompare(actualToken[:], expectedToken[:]) != 1 {
			writeLocalError(w, http.StatusUnauthorized, "unauthorized", "Local bridge authorization required.")
			return
		}
		// Reject unsupported paths before ServeMux can canonicalize/redirect them.
		if r.URL.Path != "/api/status" && r.URL.Path != "/api/send" && r.URL.Path != "/api/activity-check" {
			writeLocalError(w, http.StatusNotFound, "not_found", "Local endpoint not found.")
			return
		}
		mux.ServeHTTP(w, r)
	}), nil
}

func validLocalJobID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, char := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if char != '-' {
				return false
			}
		} else if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}

func localClientConnected(client *whatsmeow.Client) bool {
	return client != nil && client.IsConnected() && client.IsLoggedIn()
}

func validLocalBrazilRecipient(recipient string) bool {
	if (len(recipient) != 12 && len(recipient) != 13) || !strings.HasPrefix(recipient, "55") {
		return false
	}
	for _, character := range recipient {
		if character < '0' || character > '9' {
			return false
		}
	}
	// The same existing area codes used by the Mel form; fixed lines remain valid.
	const areaCodes = ",11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99,"
	return strings.Contains(areaCodes, ","+recipient[2:4]+",") && (len(recipient) != 13 || recipient[4] == '9')
}

func writeLocalError(w http.ResponseWriter, status int, code, message string) {
	writeLocalJSON(w, status, localBridgeResponse{Success: false, Code: code, Message: message})
}

func writeLocalJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
