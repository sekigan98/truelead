
document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());

const demoButtons = document.querySelectorAll('[data-demo-register]');
demoButtons.forEach(btn => btn.addEventListener('click', () => {
  location.href = 'register.html';
}));
