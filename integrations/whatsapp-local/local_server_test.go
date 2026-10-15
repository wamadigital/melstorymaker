package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
)

const localTestToken = "fictitious-local-bridge-token-for-tests-only"
const localTestRecipient = "5519999999999"

func localTestHandler(t *testing.T, client *whatsmeow.Client) http.Handler {
	t.Helper()
	handler, err := newLocalRESTHandler(client, localTestToken)
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func localTestRequest(method, path, body string) *http.Request {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+localTestToken)
	request.Header.Set("Content-Type", "application/json")
	return request
}

func localTestPayload(t *testing.T, recipient, message string) string {
	t.Helper()
	data, err := json.Marshal(map[string]string{"recipient": recipient, "message": message})
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func localTestRun(t *testing.T, handler http.Handler, request *http.Request, status int, code string) *httptest.ResponseRecorder {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != status {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, status, response.Body.String())
	}
	if code != "" {
		var result localBridgeResponse
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Code != code || result.Success {
			t.Fatalf("unexpected response: %#v", result)
		}
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("local response must not be cached")
	}
	return response
}

func TestLocalBridgeFailsClosedForInvalidConfiguration(t *testing.T) {
	for _, token := range []string{"", strings.Repeat("a", 31), strings.Repeat(" ", 32), localTestToken + "\n", strings.Repeat("á", 32)} {
		if handler, err := newLocalRESTHandler(nil, token); err == nil || handler != nil {
			t.Fatal("invalid secret must not create a handler")
		}
	}
	if _, err := newLocalRESTHandler(nil, strings.Repeat("x", 32)); err != nil {
		t.Fatal("the minimum valid token length should be accepted")
	}
}

func TestLocalBridgeAuthenticatesEveryEndpoint(t *testing.T) {
	handler := localTestHandler(t, nil)
	for _, path := range []string{"/api/status", "/api/send", "/api/activity-check", "/api/download"} {
		for _, authorization := range []string{"", "Basic " + localTestToken, "Bearer wrong", "Bearer " + localTestToken + "extra", "Bearer " + localTestToken + " "} {
			request := localTestRequest(http.MethodGet, path, "")
			request.Header.Del("Authorization")
			if authorization != "" {
				request.Header.Set("Authorization", authorization)
			}
			response := localTestRun(t, handler, request, http.StatusUnauthorized, "unauthorized")
			if strings.Contains(response.Body.String(), localTestToken) {
				t.Fatal("authorization errors must not return the secret")
			}
		}
	}
	request := localTestRequest(http.MethodGet, "/api/status", "")
	request.Header.Add("Authorization", "Bearer "+localTestToken)
	localTestRun(t, handler, request, http.StatusUnauthorized, "unauthorized")
}

func TestLocalBridgeRejectsBrowserOriginEvenWithValidToken(t *testing.T) {
	handler := localTestHandler(t, nil)
	for _, origin := range []string{"https://example.invalid", "null", ""} {
		request := localTestRequest(http.MethodPost, "/api/send", localTestPayload(t, localTestRecipient, "fictitious message"))
		request.Header.Set("Origin", origin)
		response := localTestRun(t, handler, request, http.StatusForbidden, "origin_not_allowed")
		if response.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatal("the bridge must not enable browser CORS")
		}
	}
}

func TestLocalBridgeSimulationStatusDoesNotContainPrivateData(t *testing.T) {
	response := localTestRun(t, localTestHandler(t, nil), localTestRequest(http.MethodGet, "/api/status", ""), http.StatusOK, "")
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result) != 2 || result["simulation"] != true || result["connected"] != false {
		t.Fatalf("unexpected simulation status: %#v", result)
	}
}

func TestLocalBridgeValidTextNeverSendsInSimulation(t *testing.T) {
	handler := localTestHandler(t, nil)
	for _, message := range []string{"fictitious message", "Mensagem com ação e coração 🧡", strings.Repeat("🧡", 4000)} {
		response := localTestRun(t, handler, localTestRequest(http.MethodPost, "/api/send", localTestPayload(t, localTestRecipient, message)), http.StatusOK, "simulation_no_send")
		if strings.Contains(response.Body.String(), localTestRecipient) || strings.Contains(response.Body.String(), message) {
			t.Fatal("simulation must not return the phone or message body")
		}
	}
	localTestRun(t, handler, localTestRequest(http.MethodPost, "/api/send", localTestPayload(t, "551133334444", "fixed-line fixture")), http.StatusOK, "simulation_no_send")
}

func TestLocalBridgeRejectsBlankAndOversizedText(t *testing.T) {
	handler := localTestHandler(t, nil)
	for _, message := range []string{"", " \t\r\n", "\u2003\u00a0", strings.Repeat("a", 4001), strings.Repeat("🧡", 4001)} {
		localTestRun(t, handler, localTestRequest(http.MethodPost, "/api/send", localTestPayload(t, localTestRecipient, message)), http.StatusBadRequest, "invalid_message")
	}
}

func TestLocalBridgeRejectsGroupsForeignNumbersAndMalformedRecipients(t *testing.T) {
	handler := localTestHandler(t, nil)
	for _, recipient := range []string{"", "19999999999", "+5519999999999", "55 19 999999999", "1551999999999", "5519999999999@g.us", "5519999999999@s.whatsapp.net", "5500999999999", "5520999999999", "5511888888888", "55199999999999"} {
		localTestRun(t, handler, localTestRequest(http.MethodPost, "/api/send", localTestPayload(t, recipient, "fictitious message")), http.StatusBadRequest, "invalid_recipient")
	}
}

func TestLocalBridgeRejectsMalformedJSONUnknownFieldsAndMediaPaths(t *testing.T) {
	handler := localTestHandler(t, nil)
	valid := localTestPayload(t, localTestRecipient, "fictitious message")
	for _, body := range []string{
		"", "{", "[]", valid + "{}", valid + " trailing",
		`{"recipient":"5519999999999","message":123}`,
		`{"recipient":"5519999999999","message":"fixture","media_path":"/private/secret"}`,
		`{"recipient":"5519999999999","message":"fixture","path":"../../secret"}`,
		`{"recipient":"5519999999999","message":"fixture","message_id":"fixture"}`,
	} {
		localTestRun(t, handler, localTestRequest(http.MethodPost, "/api/send", body), http.StatusBadRequest, "invalid_payload")
	}
	for _, body := range []string{"null", "{}", `{"message":"fixture"}`} {
		localTestRun(t, handler, localTestRequest(http.MethodPost, "/api/send", body), http.StatusBadRequest, "invalid_recipient")
	}
	invalidUTF8 := `{"recipient":"5519999999999","message":"` + string([]byte{0xff}) + `"}`
	localTestRun(t, handler, localTestRequest(http.MethodPost, "/api/send", invalidUTF8), http.StatusBadRequest, "invalid_payload")
}

func TestLocalBridgeRequiresUTF8JSONContentType(t *testing.T) {
	handler := localTestHandler(t, nil)
	body := localTestPayload(t, localTestRecipient, "fixture")
	for _, contentType := range []string{"", "text/plain", "application/x-www-form-urlencoded", "application/json; charset=iso-8859-1", "broken;"} {
		request := localTestRequest(http.MethodPost, "/api/send", body)
		request.Header.Set("Content-Type", contentType)
		localTestRun(t, handler, request, http.StatusUnsupportedMediaType, "invalid_content_type")
	}
	request := localTestRequest(http.MethodPost, "/api/send", body)
	request.Header.Set("Content-Type", "application/json; charset=UTF-8")
	localTestRun(t, handler, request, http.StatusOK, "simulation_no_send")
}

func TestLocalBridgeEnforces64KiBOnTheEntireBody(t *testing.T) {
	handler := localTestHandler(t, nil)
	body := localTestPayload(t, localTestRecipient, "fixture")
	atLimit := body + strings.Repeat(" ", 64*1024-len(body))
	localTestRun(t, handler, localTestRequest(http.MethodPost, "/api/send", atLimit), http.StatusOK, "simulation_no_send")
	localTestRun(t, handler, localTestRequest(http.MethodPost, "/api/send", atLimit+" "), http.StatusRequestEntityTooLarge, "body_too_large")
}

func TestLocalBridgeExposesOnlyStatusAndTextSendWithCorrectMethods(t *testing.T) {
	handler := localTestHandler(t, nil)
	for _, path := range []string{"/", "/api/download", "/api/send_file", "/api/send/media", "/api//send", "/api/../status", "/store/whatsapp.db"} {
		localTestRun(t, handler, localTestRequest(http.MethodPost, path, "{}"), http.StatusNotFound, "not_found")
	}
	for _, test := range []struct{ path, method, allow string }{
		{"/api/status", http.MethodPost, http.MethodGet},
		{"/api/send", http.MethodGet, http.MethodPost},
		{"/api/send", http.MethodOptions, http.MethodPost},
	} {
		response := localTestRun(t, handler, localTestRequest(test.method, test.path, "{}"), http.StatusMethodNotAllowed, "method_not_allowed")
		if response.Header().Get("Allow") != test.allow {
			t.Fatal("method response must document the supported method")
		}
	}
}

func TestLocalBridgeDisconnectedLiveClientDoesNotAttemptSend(t *testing.T) {
	// A zero-value SDK client has no socket or login. No client is initialized,
	// paired or connected, and no WhatsApp network transport exists in this test.
	handler := localTestHandler(t, &whatsmeow.Client{})
	localTestRun(t, handler, localTestRequest(http.MethodPost, "/api/send", localTestPayload(t, localTestRecipient, "fixture")), http.StatusServiceUnavailable, "not_connected")
	response := localTestRun(t, handler, localTestRequest(http.MethodGet, "/api/status", ""), http.StatusOK, "")
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["simulation"] != false || result["connected"] != false {
		t.Fatalf("unexpected live/disconnected status: %#v", result)
	}
}

func TestLocalBridgeHTTPResourceDeadlinesAreBounded(t *testing.T) {
	server := newLocalHTTPServer(localTestHandler(t, nil))
	for _, deadline := range []time.Duration{server.ReadHeaderTimeout, server.ReadTimeout, server.WriteTimeout, server.IdleTimeout} {
		if deadline <= 0 || deadline > time.Minute {
			t.Fatal("HTTP operations must have finite deadlines no longer than a minute")
		}
	}
	if server.MaxHeaderBytes <= 0 || server.MaxHeaderBytes > 64*1024 {
		t.Fatal("HTTP headers must have a bounded size")
	}
}
