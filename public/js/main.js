const navToggle = document.querySelector('.nav-toggle');
const navMenu = document.querySelector('.nav-menu');

if (navToggle && navMenu) {
  navToggle.addEventListener('click', () => {
    const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!isOpen));
    navMenu.classList.toggle('is-open', !isOpen);
  });

  navMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navToggle.setAttribute('aria-expanded', 'false');
      navMenu.classList.remove('is-open');
    });
  });
}

const profileMenu = document.querySelector('.profile-menu');
const profileMenuButton = document.querySelector('[data-profile-menu-button]');
const profileDropdown = document.querySelector('[data-profile-dropdown]');

function closeProfileMenu() {
  if (!profileMenu || !profileMenuButton) {
    return;
  }

  profileMenu.classList.remove('is-open');
  profileMenuButton.setAttribute('aria-expanded', 'false');
}

if (profileMenu && profileMenuButton && profileDropdown) {
  profileMenuButton.addEventListener('click', () => {
    const isOpen = profileMenuButton.getAttribute('aria-expanded') === 'true';
    profileMenu.classList.toggle('is-open', !isOpen);
    profileMenuButton.setAttribute('aria-expanded', String(!isOpen));
  });

  document.addEventListener('click', (event) => {
    if (!profileMenu.contains(event.target)) {
      closeProfileMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeProfileMenu();
      profileMenuButton.focus();
    }
  });
}

document.querySelectorAll('[data-password-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const shouldShow = input.type === 'password';
    input.type = shouldShow ? 'text' : 'password';
    button.textContent = shouldShow ? 'Hide' : 'Show';
    button.setAttribute('aria-label', shouldShow ? 'Hide password' : 'Show password');
  });
});

const noticeShell = document.querySelector('.notice-shell');
const noticeClose = document.querySelector('.notice-close');
if (noticeShell && noticeClose) {
  const dismissNotice = () => {
    noticeShell.classList.add('is-leaving');
    window.setTimeout(() => noticeShell.remove(), 180);
  };

  noticeClose.addEventListener('click', dismissNotice);
  window.setTimeout(dismissNotice, 6000);
}

const year = document.getElementById('current-year');
if (year) {
  year.textContent = new Date().getFullYear();
}

const bioInput = document.querySelector('[data-character-count]');
const bioCount = document.querySelector('[data-bio-count]');

if (bioInput && bioCount) {
  const updateBioCount = () => {
    bioCount.textContent = String(bioInput.value.length);
  };

  bioInput.addEventListener('input', updateBioCount);
  updateBioCount();
}

const genreChoices = [...document.querySelectorAll('input[name="favoriteGenres"]')];

function updateGenreChoices() {
  const selectedCount = genreChoices.filter((choice) => choice.checked).length;
  genreChoices.forEach((choice) => {
    choice.disabled = selectedCount >= 5 && !choice.checked;
  });
}

genreChoices.forEach((choice) => choice.addEventListener('change', updateGenreChoices));
updateGenreChoices();

const reviewText = document.querySelector('[data-review-text]');
const reviewCount = document.querySelector('[data-review-count]');

if (reviewText && reviewCount) {
  const updateReviewCount = () => {
    reviewCount.textContent = String(reviewText.value.length);
  };

  reviewText.addEventListener('input', updateReviewCount);
  updateReviewCount();
}

document.querySelectorAll('[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!window.confirm(form.dataset.confirm)) {
      event.preventDefault();
    }
  });
});
