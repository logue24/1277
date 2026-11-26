const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby0LOvOtT-nBEBKDcBkdPIX_GTLwy9KQ43hwSfvg6TRsoZ7mHZmweXdomiQx1CViqbRBw/exec";

const btn = document.getElementById("btnChuoi");
const btnText = document.getElementById("btnText");
const countdownEl = document.getElementById("countdown");
const totalClicksEl = document.getElementById("totalClicks");
const messageEl = document.getElementById("message");

let remainingMs = 0;
let timerInterval = null;
let hasPlayedSound = false;          // Tránh phát nhiều lần
let audioCtx = null;

// ===== TẠO ÂM THANH THÔNG BÁO =====
function playNotificationSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Nếu AudioContext bị suspend (do chính sách trình duyệt) thì resume
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;

    // Tạo tiếng "ting" dễ nghe
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, now);          // Nốt A5
    oscillator.frequency.exponentialRampToValueAtTime(1320, now + 0.1);

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

    oscillator.start(now);
    oscillator.stop(now + 0.4);
  } catch (e) {
    console.log("Không phát được âm thanh:", e);
  }
}

// Format thời gian còn lại
function formatTime(ms) {
  if (ms <= 0) return "00:00:00";
  
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return [
    hours.toString().padStart(2, "0"),
    minutes.toString().padStart(2, "0"),
    seconds.toString().padStart(2, "0")
  ].join(":");
}

// Cập nhật giao diện countdown
function updateCountdown() {
  countdownEl.textContent = formatTime(remainingMs);
  
  if (remainingMs <= 0) {
    btn.disabled = false;
    btnText.textContent = "Nhấn Chuỗi Ngay";
    
    // Phát âm thanh thông báo (chỉ 1 lần)
    if (!hasPlayedSound) {
      playNotificationSound();
      hasPlayedSound = true;
    }
    
    clearInterval(timerInterval);
  } else {
    btn.disabled = true;
    btnText.textContent = "Đang chờ...";
    hasPlayedSound = false;   // Reset khi còn thời gian chờ
  }
}

// Bắt đầu đếm ngược
function startCountdown(ms) {
  remainingMs = ms;
  updateCountdown();
  
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    remainingMs -= 1000;
    if (remainingMs < 0) remainingMs = 0;
    updateCountdown();
  }, 1000);
}

// Gọi Apps Script
async function callScript() {
  btn.disabled = true;
  btnText.textContent = "Đang xử lý...";
  messageEl.textContent = "";
  messageEl.className = "message";
  
  try {
    const res = await fetch(SCRIPT_URL + "?t=" + Date.now());
    const data = await res.json();
    
    totalClicksEl.textContent = data.totalClicks || 0;
    
    if (data.success) {
      messageEl.textContent = data.message;
      messageEl.className = "message success";
      startCountdown(data.remaining);
    } else {
      messageEl.textContent = data.message;
      messageEl.className = "message error";
      startCountdown(data.remaining);
    }
  } catch (err) {
    messageEl.textContent = "Không kết nối được server. Thử lại sau.";
    messageEl.className = "message error";
    btn.disabled = false;
    btnText.textContent = "Thử lại";
  }
}

// Sự kiện nhấn nút
btn.addEventListener("click", () => {
  // Mở khóa AudioContext khi người dùng tương tác
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  callScript();
});

// Tự động kiểm tra khi mở trang
window.addEventListener("load", () => {
  callScript();
});
