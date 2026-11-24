//! Chống fingerprint cho webview tab.
//!
//! Script được gắn bằng `initialization_script` khi tạo webview, nên WebView2
//! chạy lại ở mỗi lần điều hướng. Bật/tắt có hiệu lực với tab tạo sau đó.

use std::sync::atomic::{AtomicBool, Ordering};

/// Trạng thái bật/tắt chống fingerprint cho toàn bộ phiên chạy.
#[derive(Default)]
pub struct FingerprintState {
    enabled: AtomicBool,
}

impl FingerprintState {
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    pub fn toggle(&self) -> bool {
        let cur = self.enabled.load(Ordering::SeqCst);
        let next = !cur;
        self.enabled.store(next, Ordering::SeqCst);
        next
    }
}

/// Script JavaScript chống fingerprint, chạy trong ngữ cảnh trang web.
const FINGERPRINT_JS: &str = r##"
(function () {
  'use strict';

  // ---------- 1. Canvas fingerprinting ----------
  try {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function () {
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    };
  } catch (e) {}

  try {
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      const ctx = origGetContext.apply(this, [type, ...args]);
      if (type === '2d' && ctx) {
        const origFillRect = ctx.fillRect.bind(ctx);
        ctx.fillRect = function (x, y, w, h) {
          origFillRect(x, y, w, h);
        };
        const origGetImageData = ctx.getImageData.bind(ctx);
        ctx.getImageData = function (x, y, w, h) {
          try {
            return origGetImageData(x, y, w, h);
          } catch {
            return origGetImageData(0, 0, 1, 1);
          }
        };
      }
      return ctx;
    };
  } catch (e) {}

  // ---------- 2. WebRTC (tránh rò rỉ IP địa phương) ----------
  if (typeof window.RTCPeerConnection !== 'undefined') {
    window.RTCPeerConnection = function () {};
    window.RTCPeerConnection.prototype = {
      createOffer: function () { return Promise.reject(new Error('WebRTC disabled by Bytwina')); },
      createAnswer: function () { return Promise.reject(new Error('WebRTC disabled by Bytwina')); },
      setLocalDescription: function () { return Promise.reject(new Error('WebRTC disabled by Bytwina')); },
      setRemoteDescription: function () { return Promise.reject(new Error('WebRTC disabled by Bytwina')); },
      addIceCandidate: function () { return Promise.reject(new Error('WebRTC disabled by Bytwina')); },
      close: function () {},
      getConfiguration: function () { return {}; },
      createDataChannel: function () { return null; },
      addTrack: function () { return null; },
      removeTrack: function () {},
      getSenders: function () { return []; },
      getReceivers: function () { return []; },
      getTransceivers: function () { return []; },
      addTransceiver: function () { return null; },
    };
    try { window.RTCSessionDescription = function () {}; } catch {}
    try { window.RTCIceCandidate = function () {}; } catch {}
  }

  // ---------- 3. AudioContext fingerprinting ----------
  if (typeof window.AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined') {
    const OriginalAC = window.AudioContext || window.webkitAudioContext;
    try {
      window.AudioContext = function () {
        const ctx = new OriginalAC();
        const origCreateOscillator = ctx.createOscillator.bind(ctx);
        ctx.createOscillator = function () {
          const osc = origCreateOscillator();
          const origStart = osc.start.bind(osc);
          osc.start = function () { origStart(); };
          const origStop = osc.stop.bind(osc);
          osc.stop = function () { origStop(); };
          return osc;
        };
        const origCreateAnalyser = ctx.createAnalyser.bind(ctx);
        ctx.createAnalyser = function () {
          const ana = origCreateAnalyser();
          const origGetByteFrequencyData = ana.getByteFrequencyData.bind(ana);
          ana.getByteFrequencyData = function (arr) {
            if (arr) arr.fill(0);
            origGetByteFrequencyData(arr);
          };
          const origGetFloatFrequencyData = ana.getFloatFrequencyData.bind(ana);
          ana.getFloatFrequencyData = function (arr) {
            if (arr) arr.fill(0);
            origGetFloatFrequencyData(arr);
          };
          return ana;
        };
        return ctx;
      };
      window.AudioContext.prototype = OriginalAC.prototype;
    } catch (e) {}
  }

  // ---------- 4. Spoof navigator properties ----------
  function safeDefine(obj, prop, getter) {
    try {
      Object.defineProperty(obj, prop, { get: getter, configurable: true });
    } catch (e) {}
  }

  if (typeof navigator !== 'undefined') {
    safeDefine(navigator, 'languages', () => ['vi-VN', 'vi', 'en-US', 'en']);
    safeDefine(navigator, 'platform', () => 'Win32');
    safeDefine(navigator, 'hardwareConcurrency', () => 4);
    safeDefine(navigator, 'deviceMemory', () => 8);
    safeDefine(navigator, 'maxTouchPoints', () => 0);
    safeDefine(navigator, 'cookieEnabled', () => true);
    safeDefine(navigator, 'onLine', () => true);
  }

  // ---------- 5. Geolocation ----------
  if (navigator.geolocation) {
    const origGetCurrentPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = function (success, error, options) {
      if (error) {
        setTimeout(() => error({ code: 1, message: 'Permission denied by Bytwina' }), 100);
        return;
      }
      if (success) {
        setTimeout(() => success({
          coords: { latitude: 0, longitude: 0, accuracy: 0, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
          timestamp: Date.now(),
        }), 100);
        return;
      }
    };
    const origWatchPosition = navigator.geolocation.watchPosition.bind(navigator.geolocation);
    navigator.geolocation.watchPosition = function () { return 0; };
    const origClearWatch = navigator.geolocation.clearWatch.bind(navigator.geolocation);
    navigator.geolocation.clearWatch = function () {};
  }

  // ---------- 6. Chặn battery API ----------
  if (navigator.getBattery) {
    navigator.getBattery = function () {
      return Promise.reject(new Error('Battery API disabled by Bytwina'));
    };
  }
})();
"##;

/// Script JavaScript chống fingerprint, chạy trong ngữ cảnh trang web.
pub fn script() -> &'static str {
    FINGERPRINT_JS
}
