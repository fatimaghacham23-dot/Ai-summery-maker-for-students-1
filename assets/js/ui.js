const toastPortal = document.getElementById("toastPortal") || (() => {
  const wrapper = document.createElement("div");
  wrapper.className = "toast-wrapper";
  document.body.appendChild(wrapper);
  return wrapper;
})();

const VARIANT_CLASSES = {
  neutral: "",
  success: "toast--success",
  error: "toast--error",
};

const showToast = (message, variant = "neutral") => {
  if (!message || !toastPortal) {
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast ${VARIANT_CLASSES[variant] || ""}`.trim();
  toast.textContent = message;
  toastPortal.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  const settle = () => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  };

  setTimeout(settle, 2600);
};

const initSpatialParallax = () => {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduceMotion) {
    shell.style.setProperty("--shell-tilt-x", "0deg");
    shell.style.setProperty("--shell-tilt-y", "0deg");
    return;
  }

  const MAX_DEG = 2;
  const cardsSelector = ".card";
  let rafId = null;
  let targetX = 0;
  let targetY = 0;

  const apply = () => {
    rafId = null;
    const tiltX = targetY * MAX_DEG;
    const tiltY = targetX * MAX_DEG;

    shell.style.setProperty("--shell-tilt-x", `${tiltX.toFixed(3)}deg`);
    shell.style.setProperty("--shell-tilt-y", `${tiltY.toFixed(3)}deg`);

    const cards = document.querySelectorAll(cardsSelector);
    const cardTiltX = (-tiltX * 0.85).toFixed(3);
    const cardTiltY = (-tiltY * 0.85).toFixed(3);
    cards.forEach((card) => {
      card.style.setProperty("--card-tilt-x", `${cardTiltX}deg`);
      card.style.setProperty("--card-tilt-y", `${cardTiltY}deg`);
    });
  };

  const schedule = () => {
    if (rafId != null) return;
    rafId = window.requestAnimationFrame(apply);
  };

  const onMove = (event) => {
    const x = event.clientX / window.innerWidth;
    const y = event.clientY / window.innerHeight;
    targetX = (x - 0.5) * 2;
    targetY = (y - 0.5) * 2;
    schedule();
  };

  const onLeave = () => {
    targetX = 0;
    targetY = 0;
    schedule();
  };

  window.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("mouseleave", onLeave, { passive: true });

  apply();
};

export { showToast, initSpatialParallax };
