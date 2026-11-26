const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby0LOvOtT-nBEBKDcBkdPIX_GTLwy9KQ43hwSfvg6TRsoZ7mHZmweXdomiQx1CViqbRBw/exec";

const btn = document.getElementById("btnChuoi");
const btnText = document.getElementById("btnText");
const countdownEl = document.getElementById("countdown");
const totalClicksEl = document.getElementById("totalClicks");
const messageEl = document.getElementById("message");

let remainingMs = 0;
let timerInterval = null;

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

function updateCountdown() {
  countdownEl.textContent = formatTime(remainingMs);
  
  if (remainingMs <= 0) {
    btn.disabled = false;
    btnText.textContent = "Nhấn Chuỗi Ngay";
    clearInterval(timerInterval);
  } else {
    btn.disabled = true;
    btnText.textContent = "Đang chờ...";
  }
}

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

btn.addEventListener("click", callScript);

window.addEventListener("load", () => {
  callScript();
});
