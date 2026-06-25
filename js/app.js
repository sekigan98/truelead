const yearEls = document.querySelectorAll('[data-year]');
yearEls.forEach(el => (el.textContent = new Date().getFullYear()));

const menuToggle = document.querySelector('[data-menu-toggle]');
const menu = document.querySelector('[data-menu]');
if (menuToggle && menu) {
  menuToggle.addEventListener('click', () => menu.classList.toggle('open'));
}

const currentPage = document.body.dataset.page;
document.querySelectorAll('.nav a').forEach((link) => {
  const href = link.getAttribute('href');
  if ((currentPage === 'home' && href === '#features') ||
      (currentPage === 'dashboard' && href === 'dashboard.html')) {
    link.classList.add('active');
  }
});
