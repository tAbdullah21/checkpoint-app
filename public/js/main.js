/*
 * Checkpoint front-end behaviour. Every feature here is an enhancement: forms and links work without
 * JavaScript, and the script only makes them faster or nicer (search palette, drag and drop, the game
 * picker, inline updates and animations).
 */
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // An icon from the SVG sprite in the page (see partials/icon-sprite.ejs).
  function icon(name, className = 'icon') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  // Counts characters the same way the server validates them (an emoji counts as one).
  function characterLength(value) {
    return [...value].length;
  }

  /* Toasts ------------------------------------------------------------------------------------------ */

  const toastRegion = $('[data-toast-region]');

  function dismissToast(toast) {
    if (!toast || toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 230);
  }

  function armToast(toast) {
    $('[data-toast-close]', toast)?.addEventListener('click', () => dismissToast(toast));
    window.setTimeout(() => dismissToast(toast), 6000);
  }

  function showToast(message, type = 'success') {
    if (!toastRegion) return;
    const toast = element('div', `toast toast-${type}`);
    toast.dataset.toast = '';
    const badge = element('span', 'toast-icon');
    badge.append(icon(type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info'));
    const close = element('button', 'toast-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss message');
    close.dataset.toastClose = '';
    close.append(icon('x', 'icon icon-sm'));
    toast.append(badge, element('p', '', message), close);
    toastRegion.append(toast);
    armToast(toast);
  }

  $$('[data-toast]').forEach(armToast);

  /* Posting forms in the background ---------------------------------------------------------------------- */

  // Sends a form to its normal action but asks for JSON. Same-origin fetches carry the Origin header,
  // so the server's cross-site request check still applies.
  async function postForm(form, extra = {}) {
    const body = new URLSearchParams(new FormData(form));
    for (const [key, value] of Object.entries(extra)) {
      if (value === null) body.delete(key);
      else body.set(key, value);
    }
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'same-origin',
      body,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok || !data || data.ok === false) {
      throw new Error(data?.message || 'Something went wrong. Please try again.');
    }
    return data;
  }

  /* Ranked lists: move a game up or down ------------------------------------------------------------------------ */

  // Without JavaScript each arrow posts a form and the page reloads; with it the card moves in place, the
  // ranks are renumbered and screen readers hear the new position.
  function setUpRankedList() {
    const rankedList = $('[data-ranked-list]');
    if (!rankedList) return;
    const rankStatus = $('[data-ranked-status]');
    const renumber = () => {
      const cards = $$('.ranked-card', rankedList);
      cards.forEach((card, index) => {
        $('.ranked-number', card).textContent = String(index + 1);
        $('[data-poster-link]', card).setAttribute('aria-label', `${index + 1}. ${card.dataset.title}`);
        $('[data-direction="up"]', card).disabled = index === 0;
        $('[data-direction="down"]', card).disabled = index === cards.length - 1;
      });
    };

    rankedList.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-move-form]');
      if (!form) return;
      event.preventDefault();
      const card = form.closest('.ranked-card');
      const button = $('button', form);
      const direction = button.dataset.direction;
      button.disabled = true;
      try {
        const data = await postForm(form);
        if (direction === 'up') card.previousElementSibling?.before(card);
        else card.nextElementSibling?.after(card);
        renumber();
        // Keep the keyboard on the card: if it reached the top or bottom, use the other arrow.
        (button.disabled ? $(`[data-direction="${direction === 'up' ? 'down' : 'up'}"]`, card) : button).focus();
        if (rankStatus) rankStatus.textContent = `${card.dataset.title} is now number ${data.position} of ${data.total}.`;
        if (!prefersReducedMotion) {
          card.classList.remove('is-moved');
          void card.offsetWidth;
          card.classList.add('is-moved');
        }
      } catch (error) {
        renumber();
        showToast(error.message, 'error');
      }
    });
  }
  setUpRankedList();

  /* Header: account menu ------------------------------------------------------------------------------------ */

  function setUpProfileMenu() {
    const profileMenu = $('[data-profile-menu]');
    const profileButton = $('[data-profile-menu-button]');
    if (!profileMenu || !profileButton) return;
    const setMenu = (open) => {
      profileMenu.classList.toggle('is-open', open);
      profileButton.setAttribute('aria-expanded', String(open));
    };
    profileButton.addEventListener('click', () => setMenu(profileButton.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('click', (event) => {
      if (!profileMenu.contains(event.target)) setMenu(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && profileMenu.classList.contains('is-open')) {
        setMenu(false);
        profileButton.focus();
      }
    });
  }
  setUpProfileMenu();

  /* Small form helpers --------------------------------------------------------------------------------------- */

  $$('[data-password-toggle]').forEach((button) => {
    // "Show new password" ↔ "Hide new password": the label keeps naming the field it belongs to.
    const field = button.getAttribute('aria-label').replace(/^Show /, '');
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
      button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${field}`);
    });
  });

  // <textarea data-count-target="id"> updates the element with that id.
  $$('[data-count-target]').forEach((field) => {
    const output = document.getElementById(field.dataset.countTarget);
    if (!output) return;
    const update = () => {
      output.textContent = String(characterLength(field.value));
    };
    field.addEventListener('input', update);
    update();
  });

  const genreChoices = $$('input[name="favoriteGenres"]');
  const updateGenreChoices = () => {
    const selected = genreChoices.filter((choice) => choice.checked).length;
    genreChoices.forEach((choice) => {
      choice.disabled = selected >= 5 && !choice.checked;
    });
  };
  genreChoices.forEach((choice) => choice.addEventListener('change', updateGenreChoices));
  updateGenreChoices();

  $$('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    });
  });

  // Shortcut hints match the keyboard: ⌘K on Apple devices, Ctrl K everywhere else.
  function showShortcutKeys() {
    const isApple = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgentData?.platform || navigator.platform || '');
    if (isApple) return;
    $$('[data-shortcut-key]').forEach((key) => {
      key.textContent = 'Ctrl K';
    });
  }
  showShortcutKeys();

  const year = document.getElementById('current-year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* Search palette (⌘K, Ctrl+K or /) ------------------------------------------------------------------------- */

  function setUpPalette() {
    const palette = $('[data-palette]');
    const paletteInput = $('[data-palette-input]');
    const paletteResults = $('[data-palette-results]');
    if (!palette || !paletteInput || !paletteResults || typeof palette.showModal !== 'function') return;
    const palettePages = $$('[data-palette-pages] a').map((link) => ({
      label: link.textContent.trim(),
      href: link.getAttribute('href'),
      icon: link.dataset.icon || 'arrow-right',
    }));

    let activeIndex = 0;
    let requestCounter = 0;
    let debounceTimer = null;

    const items = () => $$('.palette-item', paletteResults);

    const setActive = (index) => {
      const list = items();
      if (list.length === 0) {
        paletteInput.removeAttribute('aria-activedescendant');
        return;
      }
      activeIndex = (index + list.length) % list.length;
      list.forEach((item, itemIndex) => {
        const isActive = itemIndex === activeIndex;
        item.classList.toggle('is-active', isActive);
        item.setAttribute('aria-selected', String(isActive));
      });
      paletteInput.setAttribute('aria-activedescendant', list[activeIndex].id);
      list[activeIndex].scrollIntoView({ block: 'nearest' });
    };

    const pageItem = (page, index) => {
      const link = element('a', 'palette-item');
      link.href = page.href;
      link.id = `palette-page-${index}`;
      link.setAttribute('role', 'option');
      const badge = element('span', 'palette-item-icon');
      badge.append(icon(page.icon));
      const copy = element('span', 'palette-item-copy');
      copy.append(element('strong', '', page.label));
      link.append(badge, copy);
      return link;
    };

    const gameItem = (game, index) => {
      const link = element('a', 'palette-item');
      link.href = game.url;
      link.id = `palette-game-${index}`;
      link.setAttribute('role', 'option');
      const image = element('img');
      image.src = game.thumbnail || game.image;
      image.alt = '';
      image.width = 34;
      image.height = 50;
      const copy = element('span', 'palette-item-copy');
      copy.append(element('strong', '', game.title), element('small', '', `${game.year} · ${game.genre}`));
      link.append(image, copy, element('span', 'palette-item-rating', `★ ${Number(game.rating).toFixed(1)}`));
      return link;
    };

    const render = (query, games) => {
      paletteResults.replaceChildren();
      const needle = query.toLowerCase();
      const pages = palettePages.filter((page) => !needle || page.label.toLowerCase().includes(needle));

      if (games.length > 0) {
        paletteResults.append(element('p', 'palette-group-title', 'Games'));
        games.forEach((game, index) => paletteResults.append(gameItem(game, index)));
        const all = pageItem({ label: `See all results for “${query}”`, href: `/games?query=${encodeURIComponent(query)}`, icon: 'search' }, 'all');
        paletteResults.append(all);
      } else if (query.length >= 2) {
        // No games match: show message OUTSIDE the listbox role to avoid aria issues
        const empty = element('p', 'palette-empty', `No games match “${query}”.`);
        empty.setAttribute('role', 'status');
        empty.setAttribute('aria-live', 'polite');
        paletteResults.append(empty);
      }

      if (pages.length > 0) {
        paletteResults.append(element('p', 'palette-group-title', query ? 'Pages' : 'Jump to'));
        pages.forEach((page, index) => paletteResults.append(pageItem(page, index)));
      }
      setActive(0);
    };

    const search = async () => {
      const query = paletteInput.value.trim();
      const requestId = ++requestCounter;
      if (query.length < 2) {
        render(query, []);
        return;
      }
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' } });
        const data = response.ok ? await response.json() : { results: [] };
        if (requestId === requestCounter) render(query, data.results || []);
      } catch {
        if (requestId === requestCounter) render(query, []);
      }
    };

    const openPalette = () => {
      if (palette.open) return;
      palette.showModal();
      paletteInput.value = '';
      render('', []);
      paletteInput.focus();
    };

    $$('[data-palette-open]').forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        openPalette();
      });
    });

    $('[data-palette-close]')?.addEventListener('click', () => palette.close());
    palette.addEventListener('click', (event) => {
      if (event.target === palette) palette.close();
    });

    document.addEventListener('keydown', (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (palette.open) palette.close();
        else openPalette();
      } else if (event.key === '/' && !typing && !palette.open) {
        event.preventDefault();
        openPalette();
      } else if (event.key === 'Escape' && palette.open) {
        palette.close();
        paletteInput.blur();
      }
    });

    paletteInput.addEventListener('input', () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(search, 150);
    });

    paletteInput.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive(activeIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive(activeIndex - 1);
      } else if (event.key === 'Enter') {
        const active = items()[activeIndex];
        if (active && (paletteInput.value.trim().length < 2 || active.id.startsWith('palette-game') || active.id.startsWith('palette-page'))) {
          event.preventDefault();
          window.location.assign(active.href);
        }
      }
    });
  }
  setUpPalette();

  /* Rails: arrow buttons scroll one "page" of cards ------------------------------------------------------- */

  $$('[data-rail-controls]').forEach((controls) => {
    const rail = document.getElementById(controls.dataset.railControls);
    const track = rail && $('[data-rail-track]', rail);
    if (!track) return;
    const prev = $('[data-rail-prev]', controls);
    const next = $('[data-rail-next]', controls);
    const update = () => {
      const max = track.scrollWidth - track.clientWidth - 2;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= max;
      controls.hidden = max <= 0;
    };
    const page = (direction) => track.scrollBy({ left: direction * track.clientWidth * 0.9, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    prev.addEventListener('click', () => page(-1));
    next.addEventListener('click', () => page(1));
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    // Sections below the fold are not laid out until they come near (content-visibility), so measure again then.
    if ('IntersectionObserver' in window) new IntersectionObserver(update).observe(track);
    update();
  });

  /* Numbers count up when they scroll into view (the real value is already in the HTML) --------------------- */

  function setUpCountUp() {
    const countTargets = $$('[data-count-up]');
    if (countTargets.length === 0 || prefersReducedMotion || !('IntersectionObserver' in window)) return;
    const animate = (node) => {
      const target = Number(node.dataset.countUp);
      if (!Number.isFinite(target) || target <= 0) return;
      const decimals = Math.min(2, Number(node.dataset.decimals) || 0);
      const duration = decimals ? 1100 : Math.min(1400, 500 + target * 12);
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        const value = target * (1 - (1 - progress) ** 3);
        node.textContent = decimals ? value.toFixed(decimals) : String(Math.round(value));
        if (progress < 1) window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          animate(entry.target);
        }
      });
    }, { threshold: 0.4 });
    countTargets.forEach((node) => observer.observe(node));
  }
  setUpCountUp();

  /* Scroll-reveal: every [data-reveal] element slides up and fades in as it enters the viewport.
     Falls back to the CSS-only @supports(path) route when animation-timeline is unavailable.      */

  function setUpReveal() {
    if (prefersReducedMotion || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    // Observe both the semantic [data-reveal] sections and any explicit is-reveal-on-scroll elements.
    $$('#main-content [data-reveal], .is-reveal-on-scroll').forEach((el) => observer.observe(el));
  }
  setUpReveal();

  /* Poster to hero transition: the clicked cover morphs into the game page poster -------------------------- */

  function setUpPosterTransition() {
    if (!('onpagereveal' in window || CSS.supports?.('view-transition-name: none'))) return;
    document.addEventListener('click', (event) => {
      const link = event.target.closest('[data-poster-link]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      $$('.game-hero-poster img, [style*="view-transition-name"]').forEach((node) => {
        node.style.viewTransitionName = 'none';
      });
      const image = $('img', link);
      if (image) image.style.viewTransitionName = 'game-poster';
    });
    // Coming back with the browser's back button: clear the names so the next click starts fresh.
    window.addEventListener('pageshow', () => {
      $$('[data-poster-link] img').forEach((image) => {
        image.style.viewTransitionName = '';
      });
    });
  }
  setUpPosterTransition();

  /* Cards come alive: a 3D tilt that follows the pointer, and a muted six-second trailer preview on hover ----- */

  function setUpLiveCards() {
    const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
    const grid = document;
    let active = null;

    // Covers fade in when they finish loading instead of popping in (the card shows a shimmer until then).
    $$('.game-card-poster img').forEach((image) => {
      if (image.complete && image.naturalWidth > 0) return;
      const poster = image.closest('.game-card-poster');
      poster.classList.add('is-loading');
      const done = () => poster.classList.remove('is-loading');
      image.addEventListener('load', done, { once: true });
      image.addEventListener('error', done, { once: true });
    });

    if (!finePointer || prefersReducedMotion) return;

    const stopPreview = (poster) => {
      const video = poster?.querySelector('video.poster-video');
      if (!video) return;
      poster.classList.remove('is-previewing');
      video.pause();
      window.setTimeout(() => {
        if (!poster.classList.contains('is-previewing')) video.remove();
      }, 400);
    };

    const startPreview = (poster) => {
      if (!poster.dataset.previewMp4 && !poster.dataset.previewWebm) return;
      let video = poster.querySelector('video.poster-video');
      if (!video) {
        video = element('video', 'poster-video');
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.setAttribute('aria-hidden', 'true');
        video.tabIndex = -1;
        for (const [url, type] of [[poster.dataset.previewWebm, 'video/webm'], [poster.dataset.previewMp4, 'video/mp4']]) {
          if (!url) continue;
          const source = element('source');
          source.src = url;
          source.type = type;
          video.append(source);
        }
        video.addEventListener('playing', () => poster.classList.add('is-previewing'), { once: true });
        poster.querySelector('img').after(video);
      }
      video.play().catch(() => {});
    };

    grid.addEventListener('pointerover', (event) => {
      const poster = event.target.closest?.('.game-card-poster');
      if (!poster || poster === active) return;
      if (active) stopPreview(active);
      active = poster;
      poster.previewTimer = window.setTimeout(() => startPreview(poster), 350);
    });

    grid.addEventListener('pointerout', (event) => {
      const poster = event.target.closest?.('.game-card-poster');
      if (!poster || poster.contains(event.relatedTarget)) return;
      window.clearTimeout(poster.previewTimer);
      stopPreview(poster);
      poster.style.removeProperty('--tilt-x');
      poster.style.removeProperty('--tilt-y');
      if (active === poster) active = null;
    });

    // Pointer moves are batched to one style update per frame, so tilting stays smooth on any screen.
    let tiltEvent = null;
    let tiltFrame = 0;
    const tilt = () => {
      tiltFrame = 0;
      const poster = tiltEvent?.target.closest?.('.game-card-poster');
      if (!poster) return;
      const box = poster.getBoundingClientRect();
      const x = (tiltEvent.clientX - box.left) / box.width;
      const y = (tiltEvent.clientY - box.top) / box.height;
      poster.style.setProperty('--tilt-x', `${((0.5 - y) * 10).toFixed(2)}deg`);
      poster.style.setProperty('--tilt-y', `${((x - 0.5) * 12).toFixed(2)}deg`);
      poster.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
      poster.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
    };
    grid.addEventListener('pointermove', (event) => {
      tiltEvent = event;
      if (!tiltFrame) tiltFrame = window.requestAnimationFrame(tilt);
    }, { passive: true });
  }
  setUpLiveCards();

  /* The navigation bar gains a glass background once the page is scrolled -------------------------------------- */

  (function setUpScrolledHeader() {
    const header = $('.site-header');
    if (!header) return;
    const update = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    update();
    window.addEventListener('scroll', update, { passive: true });
  })();

  /* Cinematic media: Steam artwork that fails to load is hidden (the blurred cover behind it shows instead), and
     muted trailer loops play only while on screen, never with reduced motion or the data saver on. ------------- */

  const saveData = Boolean(navigator.connection?.saveData);
  const motionAllowed = !prefersReducedMotion && !saveData;

  $$('img[data-hide-on-error]').forEach((image) => {
    const hide = () => image.classList.add('is-broken');
    if (image.complete && image.naturalWidth === 0 && image.getAttribute('src')) hide();
    image.addEventListener('error', hide, { once: true });
  });

  // The short Steam preview is only about 600 px wide, so it looks soft when stretched over a big screen. Browsers
  // that play HLS themselves (Safari) get the full trailer instead, which adapts up to full HD.
  const playsHls = Boolean(document.createElement('video').canPlayType?.('application/vnd.apple.mpegurl'));
  const BIG_SCREEN = 1200;

  function loadLoop(video) {
    if (video.dataset.loaded) return;
    video.dataset.loaded = '1';
    const big = window.innerWidth * (window.devicePixelRatio || 1) > BIG_SCREEN;
    const hls = playsHls && big && video.dataset.hls ? [[video.dataset.hls, 'application/vnd.apple.mpegurl']] : [];
    if (hls.length) video.classList.add('is-hd');
    for (const [url, type] of [...hls, [video.dataset.webm, 'video/webm'], [video.dataset.mp4, 'video/mp4']]) {
      if (!url) continue;
      const source = element('source');
      source.src = url;
      source.type = type;
      video.append(source);
    }
    video.addEventListener('playing', () => video.classList.add('is-playing'));
    video.load();
  }

  function playLoop(video) {
    if (!motionAllowed) return;
    loadLoop(video);
    video.play().catch(() => {});
  }

  /* Featured reel: auto-advancing slides (paused on hover, focus or the pause button), thumbnails as tabs. ------ */

  function setUpReel(reel) {
    const slides = $$('[data-reel-slide]', reel);
    const thumbs = $$('[data-reel-thumb]', reel);
    const pauseButton = $('[data-reel-pause]', reel);
    if (slides.length === 0) return;
    const SLIDE_MS = 8000;
    let active = 0;
    let timer = null;
    let paused = !motionAllowed;
    let hovering = false;

    const focusables = (slide) => $$('a, button', slide);
    const show = (index, { focusThumb = false } = {}) => {
      active = (index + slides.length) % slides.length;
      slides.forEach((slide, position) => {
        const on = position === active;
        slide.classList.toggle('is-active', on);
        if (on) slide.removeAttribute('aria-hidden');
        else slide.setAttribute('aria-hidden', 'true');
        focusables(slide).forEach((node) => {
          if (on) node.removeAttribute('tabindex');
          else node.setAttribute('tabindex', '-1');
        });
        const video = $('[data-reel-video]', slide);
        if (video) {
          if (on) playLoop(video);
          else video.pause();
        }
      });
      thumbs.forEach((thumb, position) => {
        const on = position === active;
        thumb.classList.toggle('is-active', on);
        thumb.setAttribute('aria-selected', on ? 'true' : 'false');
        thumb.tabIndex = on ? 0 : -1;
        thumb.style.removeProperty('--reel-run');
      });
      if (focusThumb) thumbs[active]?.focus();
      restart();
    };
    const restart = () => {
      window.clearTimeout(timer);
      reel.classList.remove('is-running');
      if (paused || hovering || slides.length < 2) return;
      void reel.offsetWidth; // restart the progress animation
      reel.classList.add('is-running');
      timer = window.setTimeout(() => show(active + 1), SLIDE_MS);
    };
    reel.style.setProperty('--reel-ms', `${SLIDE_MS}ms`);
    thumbs.forEach((thumb, index) => {
      thumb.addEventListener('click', () => show(index));
      thumb.addEventListener('keydown', (event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (event.key === 'Home') show(0, { focusThumb: true });
        else if (event.key === 'End') show(slides.length - 1, { focusThumb: true });
        else if (step) show(active + step, { focusThumb: true });
        else return;
        event.preventDefault();
      });
    });
    const setPaused = (value) => {
      paused = value;
      if (pauseButton) {
        pauseButton.setAttribute('aria-pressed', paused ? 'true' : 'false');
        pauseButton.setAttribute('aria-label', paused ? 'Play the featured games' : 'Pause the featured games');
        $('use', pauseButton)?.setAttribute('href', paused ? '#i-play' : '#i-pause');
      }
      const video = $('[data-reel-video]', slides[active]);
      if (video && paused) video.pause();
      else if (video) playLoop(video);
      restart();
    };
    pauseButton?.addEventListener('click', () => setPaused(!paused));
    reel.addEventListener('pointerenter', () => { hovering = true; restart(); });
    reel.addEventListener('pointerleave', () => { hovering = false; restart(); });
    reel.addEventListener('focusin', () => { hovering = true; restart(); });
    reel.addEventListener('focusout', (event) => {
      if (reel.contains(event.relatedTarget)) return;
      hovering = false;
      restart();
    });
    // Only play while the reel is on screen.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        const video = $('[data-reel-video]', slides[active]);
        if (!entry.isIntersecting) {
          video?.pause();
          window.clearTimeout(timer);
          reel.classList.remove('is-running');
        } else {
          if (video && !paused) playLoop(video);
          restart();
        }
      }, { threshold: 0.25 }).observe(reel);
    }
    // The first frame switches slides without the fade, so hidden slides never linger half-visible.
    reel.classList.add('is-enhanced', 'is-instant');
    setPaused(paused);
    show(0);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => reel.classList.remove('is-instant')));
  }
  $$('[data-reel]').forEach(setUpReel);

  /* Game page cinema: the wide art drifts, the game's screenshots cross-fade behind it, the trailer loop fades in
     over them when it plays, and one button pauses all of it (WCAG 2.2.2). Slides load only after the first art,
     only while the hero is on screen, and never with reduced motion or the data saver on. ------------------------ */

  (function setUpHeroCinema() {
    const cinema = $('[data-cinema]');
    const hero = cinema?.closest('.game-hero');
    if (!cinema || !hero || !motionAllowed) return;
    const video = $('[data-hero-video]', cinema);
    const toggle = $('[data-hero-motion-toggle]');
    const SLIDE_MS = 7000;
    const urls = (cinema.dataset.slides || '').split(' ').filter(Boolean);
    let slides = [$('.game-hero-art', cinema)].filter(Boolean);
    let current = 0;
    let timer = 0;
    let stopped = false;
    let onScreen = true;
    let videoPlaying = false;

    const buildSlides = () => {
      if (slides.length > 1 || urls.length === 0) return;
      urls.forEach((url, index) => {
        const image = element('img', 'game-hero-art');
        image.alt = '';
        image.decoding = 'async';
        image.setAttribute('fetchpriority', 'low');
        image.style.setProperty('--kb-origin', ['20% 30%', '80% 40%', '40% 80%', '70% 20%'][index % 4]);
        image.addEventListener('error', () => {
          slides = slides.filter((slide) => slide !== image);
          image.remove();
        }, { once: true });
        image.src = url;
        if (video) cinema.insertBefore(image, video);
        else cinema.append(image);
        slides.push(image);
      });
    };
    const show = (index) => {
      const next = slides[(index + slides.length) % slides.length];
      if (!next || (!next.complete && slides.length > 1)) return;
      slides.forEach((slide) => slide.classList.toggle('is-active', slide === next));
      current = slides.indexOf(next);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      if (stopped || !onScreen || videoPlaying || slides.length + urls.length < 2) return;
      timer = window.setTimeout(() => {
        buildSlides();
        show(current + 1);
        schedule();
      }, SLIDE_MS);
    };
    const sync = () => {
      hero.classList.toggle('is-motion-paused', stopped);
      document.dispatchEvent(new CustomEvent('checkpoint:hero-motion', { detail: { paused: stopped || !onScreen } }));
      if (!toggle) return;
      toggle.hidden = false;
      toggle.setAttribute('aria-pressed', stopped ? 'true' : 'false');
      toggle.setAttribute('aria-label', stopped ? 'Play the background motion' : 'Pause the background motion');
      $('use', toggle)?.setAttribute('href', stopped ? '#i-play' : '#i-pause');
    };
    const run = () => {
      if (video && !stopped && onScreen) playLoop(video);
      else video?.pause();
      schedule();
      sync();
    };
    toggle?.addEventListener('click', () => {
      stopped = !stopped;
      run();
    });
    video?.addEventListener('playing', () => {
      videoPlaying = true;
      schedule();
    });
    video?.addEventListener('error', () => {
      videoPlaying = false;
      schedule();
    }, true);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        run();
      }, { threshold: 0.15 }).observe(cinema);
    } else {
      run();
    }
  })();

  /* Screenshot lightbox: arrow keys, swipe-free buttons, Escape closes (the links still open the image without
     JavaScript). ----------------------------------------------------------------------------------------------- */

  (function setUpLightbox() {
    const gallery = $('[data-gallery]');
    const dialog = $('[data-lightbox]');
    if (!gallery || !dialog || typeof dialog.showModal !== 'function') return;
    const links = $$('[data-gallery-item]', gallery);
    const image = $('[data-lightbox-image]', dialog);
    const count = $('[data-lightbox-count]', dialog);
    let current = 0;
    const open = (index) => {
      current = (index + links.length) % links.length;
      const thumbImage = $('img', links[current]);
      image.src = links[current].href;
      image.alt = thumbImage?.alt || '';
      count.textContent = `${current + 1} / ${links.length}`;
      if (!dialog.open) dialog.showModal();
    };
    links.forEach((link, index) => link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      open(index);
    }));
    $$('[data-lightbox-step]', dialog).forEach((button) => button.addEventListener('click', () => open(current + Number(button.dataset.lightboxStep))));
    $('[data-lightbox-close]', dialog)?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') open(current + 1);
      else if (event.key === 'ArrowLeft') open(current - 1);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  })();

  /* Ambient motion: a light that follows the pointer over panels and cards, magnetic primary buttons, a scroll
     progress line, and the poster wall leaning toward the pointer. All off with reduced motion. ---------------- */

  (function setUpAmbientMotion() {
    const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
    const progress = element('div', 'scroll-progress');
    progress.setAttribute('aria-hidden', 'true');
    document.body.append(progress);
    // Browsers with scroll-driven animations move the line on the compositor (components.css); others get one
    // update per frame at most.
    if (!window.CSS?.supports?.('animation-timeline: scroll()')) {
      let progressFrame = 0;
      const updateProgress = () => {
        progressFrame = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
      };
      const queueProgress = () => {
        if (!progressFrame) progressFrame = window.requestAnimationFrame(updateProgress);
      };
      updateProgress();
      window.addEventListener('scroll', queueProgress, { passive: true });
      window.addEventListener('resize', queueProgress, { passive: true });
    }
    if (!fine || prefersReducedMotion) return;

    let glowEvent = null;
    let glowFrame = 0;
    const glow = () => {
      glowFrame = 0;
      const surface = glowEvent?.target.closest?.('.panel');
      if (!surface) return;
      const box = surface.getBoundingClientRect();
      surface.style.setProperty('--glow-x', `${glowEvent.clientX - box.left}px`);
      surface.style.setProperty('--glow-y', `${glowEvent.clientY - box.top}px`);
    };
    document.addEventListener('pointermove', (event) => {
      glowEvent = event;
      if (!glowFrame) glowFrame = window.requestAnimationFrame(glow);
    }, { passive: true });

    $$('.button-primary, .button-lg').forEach((button) => {
      button.addEventListener('pointermove', (event) => {
        const box = button.getBoundingClientRect();
        const x = (event.clientX - box.left - box.width / 2) / box.width;
        const y = (event.clientY - box.top - box.height / 2) / box.height;
        button.style.setProperty('--magnet-x', `${(x * 8).toFixed(1)}px`);
        button.style.setProperty('--magnet-y', `${(y * 6).toFixed(1)}px`);
      });
      button.addEventListener('pointerleave', () => {
        button.style.removeProperty('--magnet-x');
        button.style.removeProperty('--magnet-y');
      });
    });

    const hero = $('.landing-hero');
    const wall = $('.poster-wall-inner');
    if (hero && wall) {
      let wallEvent = null;
      let wallFrame = 0;
      const lean = () => {
        wallFrame = 0;
        if (!wallEvent) return;
        const box = hero.getBoundingClientRect();
        const x = (wallEvent.clientX - box.left) / box.width - 0.5;
        const y = (wallEvent.clientY - box.top) / box.height - 0.5;
        wall.style.setProperty('--wall-x', `${(x * -28).toFixed(1)}px`);
        wall.style.setProperty('--wall-y', `${(y * -22).toFixed(1)}px`);
        wall.style.setProperty('--wall-tilt', `${(x * 6).toFixed(2)}deg`);
      };
      hero.addEventListener('pointermove', (event) => {
        wallEvent = event;
        if (!wallFrame) wallFrame = window.requestAnimationFrame(lean);
      }, { passive: true });
      hero.addEventListener('pointerleave', () => {
        ['--wall-x', '--wall-y', '--wall-tilt'].forEach((name) => wall.style.removeProperty(name));
      });
    }
  })();

  /* Game pages wear the game's colours: the cover is sampled once (it is served by Checkpoint, so the canvas may
     read it) and its most vivid colour becomes the page accent. ------------------------------------------------ */

  function vividColour(image) {
    const canvas = document.createElement('canvas');
    const width = 24;
    const height = 36;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    let data;
    try {
      data = context.getImageData(0, 0, width, height).data;
    } catch {
      return null;
    }
    // Colours grouped in coarse buckets; each bucket scores by how many pixels it has and how vivid they are.
    const buckets = new Map();
    for (let index = 0; index < data.length; index += 4) {
      const [red, green, blue] = [data[index], data[index + 1], data[index + 2]];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const lightness = (max + min) / 510;
      const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
      if (lightness < 0.18 || lightness > 0.86 || saturation < 0.28) continue;
      const key = `${red >> 5},${green >> 5},${blue >> 5}`;
      const bucket = buckets.get(key) || { red: 0, green: 0, blue: 0, count: 0, weight: 0 };
      bucket.red += red;
      bucket.green += green;
      bucket.blue += blue;
      bucket.count += 1;
      bucket.weight += saturation * (1 - Math.abs(lightness - 0.55));
      buckets.set(key, bucket);
    }
    let best = null;
    for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
    if (!best || best.count < 6) return null;
    return [best.red, best.green, best.blue].map((value) => Math.round(value / best.count));
  }

  // The colour lifted to a readable brightness for glows and accents on the dark page.
  function brighten([red, green, blue]) {
    const max = Math.max(red, green, blue) || 1;
    const scale = Math.min(255 / max, 1.6);
    return [red, green, blue].map((value) => Math.min(255, Math.round(value * scale + 18)));
  }

  (function setUpGameTheme() {
    const page = $('[data-game-theme]');
    const cover = $('.game-hero-poster img', page || document);
    if (!page || !cover) return;
    const apply = () => {
      const colour = vividColour(cover);
      if (!colour) return;
      const [red, green, blue] = brighten(colour);
      page.style.setProperty('--game-accent', `rgb(${red} ${green} ${blue})`);
      page.style.setProperty('--game-accent-rgb', `${red} ${green} ${blue}`);
      page.style.setProperty('--game-accent-2', `rgb(${Math.min(255, red + 50)} ${Math.min(255, green + 50)} ${Math.min(255, blue + 50)})`);
      page.classList.add('has-game-theme');
    };
    if (cover.complete && cover.naturalWidth > 0) apply();
    else cover.addEventListener('load', apply, { once: true });
  })();

  /* The cover on a game page is a collectable card: it tilts toward the pointer and a holographic sheen follows. */

  (function setUpHoloCard() {
    const card = $('[data-holo]');
    if (!card || prefersReducedMotion || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
    let frame = 0;
    let pointer = null;
    const render = () => {
      frame = 0;
      if (!pointer) return;
      const box = card.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (pointer.clientX - box.left) / box.width));
      const y = Math.min(1, Math.max(0, (pointer.clientY - box.top) / box.height));
      card.style.setProperty('--holo-x', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--holo-y', `${(y * 100).toFixed(1)}%`);
      card.style.setProperty('--holo-rx', `${((0.5 - y) * 16).toFixed(2)}deg`);
      card.style.setProperty('--holo-ry', `${((x - 0.5) * 20).toFixed(2)}deg`);
    };
    card.addEventListener('pointermove', (event) => {
      pointer = event;
      card.classList.add('is-holo');
      if (!frame) frame = window.requestAnimationFrame(render);
    });
    card.addEventListener('pointerleave', () => {
      pointer = null;
      card.classList.remove('is-holo');
      ['--holo-rx', '--holo-ry'].forEach((name) => card.style.removeProperty(name));
    });
  })();

  /* Light particles drift up through the game hero in the game's colour; paused off screen, in background tabs,
     with the pause button, reduced motion or the data saver. Each particle is one pre-drawn glow sprite stamped
     with drawImage (no per-frame blur or style reads), so the loop stays well inside a frame even at 120 Hz+. ------ */

  (function setUpParticles() {
    const canvas = $('[data-particles]');
    if (!canvas || prefersReducedMotion || saveData) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const page = canvas.closest('[data-game-theme]') || document.documentElement;
    const SPRITE = 32;
    const sprite = document.createElement('canvas');
    sprite.width = SPRITE;
    sprite.height = SPRITE;
    let width = 0;
    let height = 0;
    let particles = [];
    let running = false;
    let visible = true;
    let paused = false;
    let frame = 0;
    let last = 0;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const paintSprite = () => {
      const accent = getComputedStyle(page).getPropertyValue('--game-accent-rgb').trim() || '34 211 238';
      const glow = sprite.getContext('2d');
      const gradient = glow.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
      gradient.addColorStop(0, 'rgb(255 255 255 / 1)');
      gradient.addColorStop(0.18, `rgb(${accent} / 0.95)`);
      gradient.addColorStop(0.45, `rgb(${accent} / 0.28)`);
      gradient.addColorStop(1, `rgb(${accent} / 0)`);
      glow.clearRect(0, 0, SPRITE, SPRITE);
      glow.fillStyle = gradient;
      glow.fillRect(0, 0, SPRITE, SPRITE);
    };
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      width = box.width;
      height = box.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.round(Math.min(70, (width * height) / 18000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        size: 5 + Math.random() * 9,
        speed: 7 + Math.random() * 21,
        drift: (Math.random() - 0.5) * 15,
        phase: Math.random() * Math.PI * 2,
      }));
    };
    // Movement is scaled by the real time between frames, so particles move at the same speed at 60, 120 or 240 Hz.
    const draw = (time) => {
      frame = 0;
      if (!running) return;
      const seconds = Math.min(0.05, last ? (time - last) / 1000 : 0.016);
      last = time;
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        particle.y -= particle.speed * seconds;
        particle.x += (particle.drift + Math.sin(time / 1600 + particle.phase) * 9) * seconds;
        if (particle.y < -16) {
          particle.y = height + 16;
          particle.x = Math.random() * width;
        }
        context.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(time / 900 + particle.phase));
        context.drawImage(sprite, particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
      }
      context.globalAlpha = 1;
      frame = window.requestAnimationFrame(draw);
    };
    const update = () => {
      const shouldRun = visible && !paused && !document.hidden;
      if (shouldRun && !running) {
        running = true;
        last = 0;
        frame = window.requestAnimationFrame(draw);
      } else if (!shouldRun && running) {
        running = false;
        window.cancelAnimationFrame(frame);
      }
    };
    paintSprite();
    resize();
    // The sprite takes the game's colour once the theme has been read from the cover.
    new MutationObserver(paintSprite).observe(page, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', update);
    document.addEventListener('checkpoint:hero-motion', (event) => {
      paused = Boolean(event.detail?.paused);
      update();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        update();
      }).observe(canvas);
    }
    update();
  })();

  /* Quick add (+ on covers, "Want to Play" buttons) ----------------------------------------------------------- */

  $$('form[data-quick-add]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('button', form);
      button.disabled = true;
      try {
        const data = await postForm(form);
        const card = form.closest('.game-card');
        if (card) {
          const badge = element('span', `status-badge ${data.statusClass}`, data.statusLabel);
          form.replaceWith(badge);
          $('.match-chip', card)?.remove();
        } else {
          button.classList.add('is-done');
          button.replaceChildren(icon('check'), document.createTextNode(` ${data.statusLabel}`));
        }
        showToast(data.message, 'success');
      } catch (error) {
        button.disabled = false;
        showToast(error.message, 'error');
      }
    });
  });

  /* Game page: one-click library status ------------------------------------------------------------------ */

  $$('form[data-status-picker]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      const submitter = event.submitter;
      if (!submitter || submitter.name !== 'status') return;
      event.preventDefault();
      const buttons = $$('.status-option', form);
      buttons.forEach((button) => {
        button.disabled = true;
      });
      try {
        const data = await postForm(form, { status: submitter.value });
        buttons.forEach((button) => {
          const current = button.value === data.status;
          button.classList.toggle('is-current', current);
          button.setAttribute('aria-pressed', String(current));
        });
        if (/\/add$/.test(form.getAttribute('action'))) {
          form.setAttribute('action', form.getAttribute('action').replace(/\/add$/, '/update'));
          const label = $('.status-picker-label', form);
          const check = element('span', 'status-check');
          check.append(icon('check', 'icon icon-sm'));
          label.replaceChildren(check, element('strong', '', 'In your library'), element('small', '', 'Change your play status'));
        }
        showToast(data.message, 'success');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        buttons.forEach((button) => {
          button.disabled = false;
        });
      }
    });
  });

  /* Auto-submit filters (catalogue selects) ------------------------------------------------------------------- */

  $$('[data-auto-submit]').forEach((control) => {
    control.addEventListener('change', () => control.form?.requestSubmit());
  });

  /* Trailer: load the YouTube player only when asked (faster pages, no third-party request until then) ----- */

  $$('[data-trailer]').forEach((container) => {
    const button = $('[data-trailer-play]', container);
    const template = $('template', container);
    if (!button || !template) return;
    button.addEventListener('click', () => {
      const frame = template.content.firstElementChild.cloneNode(true);
      if (frame.tagName === 'VIDEO') {
        container.replaceChildren(frame);
        frame.play().catch(() => {});
        frame.focus();
        return;
      }
      frame.src = `${frame.dataset.src}&autoplay=1`;
      container.replaceChildren(frame);
      frame.focus();
    });
  });

  /* Library board: drag and drop between columns, quick moves, favourites, filter -------------------------- */

  function setUpBoard() {
    const board = $('[data-board]');
    if (!board) return;
    const columns = $$('[data-board-column]', board);
    const updateCounts = () => {
      columns.forEach((column) => {
        const cards = $$('[data-board-card]', column).filter((card) => !card.hidden);
        $('[data-board-count]', column).textContent = String($$('[data-board-card]', column).length);
        column.classList.toggle('is-empty', cards.length === 0);
      });
      const total = $$('[data-board-card]', board).length;
      $$('[data-library-total]').forEach((node) => {
        node.textContent = String(total);
      });
      $$('[data-library-count]').forEach((node) => {
        const column = columns.find((item) => item.dataset.status === node.dataset.libraryCount);
        if (column) node.textContent = String($$('[data-board-card]', column).length);
      });
    };

    const syncCard = (card, status, isFavorite) => {
      card.dataset.status = status;
      card.dataset.favorite = isFavorite ? '1' : '0';
      card.classList.toggle('is-favorite', isFavorite);
      $$('input[name="isFavorite"][data-keep-favorite]', card).forEach((input) => {
        input.disabled = !isFavorite;
      });
      $$('[data-move-status]', card).forEach((button) => {
        button.classList.toggle('is-current', button.value === status);
        button.setAttribute('aria-pressed', String(button.value === status));
      });
      const favoriteForm = $('[data-favorite-form]', card);
      if (favoriteForm) {
        $('input[name="status"]', favoriteForm).value = status;
        const favoriteInput = $('input[name="isFavorite"]', favoriteForm);
        favoriteInput.disabled = isFavorite;
        const button = $('button', favoriteForm);
        button.setAttribute('aria-pressed', String(isFavorite));
        button.setAttribute('aria-label', isFavorite ? `Remove ${card.dataset.title} from profile favorites` : `Add ${card.dataset.title} to profile favorites`);
        button.replaceChildren(icon(isFavorite ? 'heart-fill' : 'heart'));
      }
    };

    const moveCard = async (card, status) => {
      if (card.classList.contains('is-saving') || card.dataset.status === status) return;
      const fromColumn = card.closest('[data-board-column]');
      const nextSibling = card.nextElementSibling;
      const target = columns.find((column) => column.dataset.status === status);
      $('[data-board-list]', target).prepend(card);
      card.classList.add('is-saving');
      updateCounts();
      try {
        const form = $('[data-move-form]', card);
        const data = await postForm(form, { status, isFavorite: card.dataset.favorite === '1' ? 'on' : null });
        syncCard(card, data.status, data.isFavorite);
        card.classList.remove('is-saving');
        card.classList.add('is-dropped');
        window.setTimeout(() => card.classList.remove('is-dropped'), 600);
        showToast(data.message, 'success');
      } catch (error) {
        $('[data-board-list]', fromColumn).insertBefore(card, nextSibling);
        card.classList.remove('is-saving');
        updateCounts();
        showToast(error.message, 'error');
      }
    };

    // Drag and drop (mouse and pen).
    let dragged = null;
    let menuPointer = false;
    board.addEventListener('pointerdown', (event) => {
      menuPointer = Boolean(event.target.closest('details, button, input, select, textarea'));
    });
    board.addEventListener('dragstart', (event) => {
      const card = event.target.closest?.('[data-board-card]');
      if (!card) return;
      if (menuPointer || card.classList.contains('is-saving')) {
        event.preventDefault();
        return;
      }
      $$('details.board-menu[open]', board).forEach((menu) => { menu.open = false; });
      dragged = card;
      card.classList.add('is-dragging');
      board.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.dataset.slug);
    });
    board.addEventListener('dragend', () => {
      dragged?.classList.remove('is-dragging');
      board.classList.remove('is-dragging');
      columns.forEach((column) => column.classList.remove('is-over'));
      dragged = null;
    });
    columns.forEach((column) => {
      column.addEventListener('dragover', (event) => {
        if (!dragged) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        column.classList.add('is-over');
      });
      column.addEventListener('dragleave', (event) => {
        if (!column.contains(event.relatedTarget)) column.classList.remove('is-over');
      });
      column.addEventListener('drop', (event) => {
        event.preventDefault();
        column.classList.remove('is-over');
        if (dragged) moveCard(dragged, column.dataset.status);
      });
    });

    // Keep native summary/keyboard behavior separate from tapping the card body.
    const menus = $$('details.board-menu', board);
    const closeMenus = (except = null) => {
      menus.forEach((menu) => { if (menu !== except) menu.open = false; });
    };
    menus.forEach((menu) => {
      menu.addEventListener('toggle', () => {
        if (menu.open) closeMenus(menu);
      });
    });
    board.addEventListener('click', (event) => {
      const button = event.target.closest('[data-move-status]');
      if (button) {
        event.preventDefault();
        const card = button.closest('[data-board-card]');
        closeMenus();
        moveCard(card, button.value);
        return;
      }
      // Summary toggles once through the browser; clicks inside the panel never toggle it.
      if (event.target.closest('details, a, button, input, select, textarea, label, form')) return;
      const card = event.target.closest('[data-board-card]');
      if (!card) return;
      const menu = $('details.board-menu', card);
      if (!menu) return;
      closeMenus(menu);
      menu.open = !menu.open;
    });
    document.addEventListener('click', (event) => {
      const card = event.target.closest('[data-board-card]');
      closeMenus(card ? $('details.board-menu', card) : null);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const open = menus.find((menu) => menu.open);
      if (!open) return;
      closeMenus();
      $('summary', open)?.focus();
      event.preventDefault();
    });

    // Favourite toggle.
    $$('[data-favorite-form]', board).forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const card = form.closest('[data-board-card]');
        const makeFavorite = card.dataset.favorite !== '1';
        try {
          const data = await postForm(form, { status: card.dataset.status, isFavorite: makeFavorite ? 'on' : null });
          syncCard(card, data.status, data.isFavorite);
          showToast(data.message, 'success');
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });

    // Remove from library.
    $$('[data-remove-form]', board).forEach((form) => {
      form.addEventListener('submit', async (event) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        const card = form.closest('[data-board-card]');
        try {
          const data = await postForm(form);
          card.classList.add('is-removing');
          window.setTimeout(() => {
            card.remove();
            updateCounts();
          }, 260);
          showToast(data.message, 'success');
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    });

    // Filter cards by title or genre.
    const filter = $('[data-board-filter]');
    filter?.addEventListener('input', () => {
      const needle = filter.value.trim().toLowerCase();
      $$('[data-board-card]', board).forEach((card) => {
        card.hidden = Boolean(needle) && !card.dataset.search.includes(needle);
      });
      updateCounts();
    });

    updateCounts();
  }
  setUpBoard();

  /* Game picker: a slot-machine reel that lands on one game (better matches come up more often) ------------ */

  function setUpPicker() {
    const picker = $('[data-picker]');
    if (!picker || typeof picker.showModal !== 'function') return;
    const candidates = $$('[data-picker-candidates] li', picker).map((item) => ({ ...item.dataset }));
    const reel = $('[data-picker-reel]', picker);
    const result = $('[data-picker-result]', picker);
    const title = $('[data-picker-title]', picker);
    const meta = $('[data-picker-meta]', picker);
    const link = $('[data-picker-link]', picker);
    const subtitle = $('[data-picker-sub]', picker);
    const defaultTitle = title.textContent;
    let spinning = false;

    const weightedPick = () => {
      const total = candidates.reduce((sum, candidate) => sum + Number(candidate.weight || 1), 0);
      let roll = Math.random() * total;
      for (const candidate of candidates) {
        roll -= Number(candidate.weight || 1);
        if (roll <= 0) return candidate;
      }
      return candidates[candidates.length - 1];
    };

    const tile = (candidate) => {
      const image = element('img');
      image.src = candidate.image;
      image.alt = '';
      image.width = 120;
      image.height = 180;
      return image;
    };

    const spin = () => {
      if (spinning || candidates.length === 0) return;
      spinning = true;
      result.hidden = true;
      title.textContent = defaultTitle;
      subtitle.hidden = false;
      const winner = weightedPick();
      const sequence = [];
      for (let index = 0; index < 60; index += 1) sequence.push(candidates[Math.floor(Math.random() * candidates.length)]);
      sequence.push(winner, candidates[Math.floor(Math.random() * candidates.length)], candidates[Math.floor(Math.random() * candidates.length)]);
      reel.replaceChildren(...sequence.map(tile));
      reel.style.transition = 'none';
      reel.style.transform = 'translateX(0)';
      window.requestAnimationFrame(() => {
        const tileWidth = reel.firstElementChild.getBoundingClientRect().width + 14;
        const windowWidth = reel.parentElement.getBoundingClientRect().width;
        const offset = 60 * tileWidth - (windowWidth / 2 - tileWidth / 2) + 7;
        reel.style.transition = prefersReducedMotion ? 'none' : 'transform 3.2s cubic-bezier(0.12, 0.8, 0.12, 1)';
        reel.style.transform = `translateX(${-offset}px)`;
      });
      window.setTimeout(() => {
        spinning = false;
        reel.children[60]?.classList.add('is-winner');
        title.textContent = winner.title;
        meta.textContent = winner.meta;
        link.href = `/games/${winner.slug}`;
        subtitle.hidden = true;
        result.hidden = false;
        link.focus();
      }, prefersReducedMotion ? 50 : 3300);
    };

    $$('[data-picker-open]').forEach((button) => {
      button.addEventListener('click', () => {
        picker.showModal();
        spin();
      });
    });
    $('[data-picker-spin]', picker)?.addEventListener('click', spin);
    $('[data-picker-close]', picker)?.addEventListener('click', () => picker.close());
    picker.addEventListener('click', (event) => {
      if (event.target === picker) picker.close();
    });
  }
  setUpPicker();

  /* Profile editor: live preview card ----------------------------------------------------------------------- */

  $$('[data-preview-source]').forEach((input) => {
    const target = document.getElementById(input.dataset.previewSource);
    if (!target) return;
    const fallback = target.dataset.fallback || '';
    const update = () => {
      const value = input.value.trim();
      target.textContent = value || fallback;
      if (target.dataset.previewInitial !== undefined) {
        const avatar = document.getElementById(target.dataset.previewInitial);
        if (avatar) avatar.textContent = ([...value][0] || '?').toUpperCase();
      }
    };
    input.addEventListener('input', update);
  });

  function setUpPreviewGenres() {
    const previewGenres = $('[data-preview-genres]');
    if (!previewGenres || genreChoices.length === 0) return;
    const renderGenres = () => {
      const chosen = genreChoices.filter((choice) => choice.checked).map((choice) => choice.value);
      previewGenres.replaceChildren(...chosen.map((genre) => element('span', 'chip', genre)));
    };
    genreChoices.forEach((choice) => choice.addEventListener('change', renderGenres));
  }
  setUpPreviewGenres();

  /* Game name fields (Versus, tier list) suggest matching games while typing, from the search API. ------------- */

  $$('[data-game-suggest]').forEach((input) => {
    const options = document.getElementById(input.getAttribute('list') || '');
    if (!options) return;
    let timer = 0;
    let controller = null;
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      const query = input.value.trim();
      if (query.length < 2) return;
      timer = window.setTimeout(async () => {
        controller?.abort();
        controller = new AbortController();
        try {
          const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
          if (!response.ok) return;
          const data = await response.json();
          options.replaceChildren(...(data.results || []).slice(0, 8).map((game) => {
            const option = document.createElement('option');
            option.value = game.title;
            option.label = `${game.year} · ${game.genre}`;
            return option;
          }));
        } catch {
          // A cancelled or failed lookup leaves the last suggestions in place.
        }
      }, 140);
    });
  });

  /* Live ticker: a pause button for the moving strip (it also stops on hover and keyboard focus). ------------- */

  $$('[data-ticker]').forEach((ticker) => {
    const toggle = $('[data-ticker-toggle]', ticker);
    if (!toggle || prefersReducedMotion) return;
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      const paused = ticker.classList.toggle('is-paused');
      toggle.setAttribute('aria-pressed', paused ? 'true' : 'false');
      toggle.setAttribute('aria-label', paused ? 'Play the live ticker' : 'Pause the live ticker');
      $('use', toggle)?.setAttribute('href', paused ? '#i-play' : '#i-pause');
    });
  });

  /* Tier list: drag covers between the rows (mouse, pen or touch) with the other covers sliding out of the way,
     or use each cover's menu; every change is saved in the background and announced to screen readers. The
     board can also be saved as a picture, drawn on a canvas from the covers already on the page. ------------- */

  (function setUpTierBoard() {
    const board = $('[data-tier-board]');
    if (!board) return;
    const page = board.closest('main');
    const status = $('[data-tier-status]', page);
    const total = $('[data-tier-total]', page);
    const lists = () => $$('[data-tier-list]', page);
    const tierName = (list) => (list.dataset.tierList === 'pool' ? 'unranked' : `tier ${list.dataset.tierList.toUpperCase()}`);
    const announce = (text) => {
      if (status) status.textContent = text;
    };

    setUpTierImage(board);
    if (!board.hasAttribute('data-editable')) return;

    const orderString = () => lists().flatMap((list) => $$('[data-tier-item]', list).map((item) => `${list.dataset.tierList}:${item.dataset.slug}`)).join(',');
    let saveTimer = 0;
    const save = () => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(async () => {
        try {
          const response = await fetch('/tiers/order', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            credentials: 'same-origin',
            body: new URLSearchParams({ order: orderString() }),
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data?.ok) throw new Error(data?.message || 'The tier list could not be saved.');
          if (total) total.textContent = total.textContent.replace(/^\d+/, String(data.total));
        } catch (error) {
          showToast(error.message, 'error');
        }
      }, 200);
    };
    const syncMenu = (item, tier) => {
      $$('.tier-choice', item).forEach((choice) => {
        const current = choice.value === tier;
        choice.classList.toggle('is-current', current);
        choice.setAttribute('aria-pressed', current ? 'true' : 'false');
      });
      const back = $('.tier-choice-pool', item);
      if (back) back.hidden = tier === 'pool';
    };
    // Covers glide to their new places (FLIP): measure, change the DOM, then animate from the old spot.
    const glide = (change, except) => {
      if (prefersReducedMotion) {
        change();
        return;
      }
      const items = $$('[data-tier-item]', page).filter((item) => item !== except);
      const before = new Map(items.map((item) => [item, item.getBoundingClientRect()]));
      change();
      for (const item of items) {
        const from = before.get(item);
        const to = item.getBoundingClientRect();
        const dx = from.left - to.left;
        const dy = from.top - to.top;
        if (dx || dy) item.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      }
    };
    const moved = (item, list) => {
      syncMenu(item, list.dataset.tierList);
      board.classList.toggle('has-games', $$('[data-tier-item]', board).length > 0);
      announce(`${item.dataset.title} moved to ${tierName(list)}.`);
      save();
    };

    // The menu on each cover: move it to the end of the chosen row.
    $$('[data-tier-form]', page).forEach((form) => form.addEventListener('submit', (event) => {
      const tier = event.submitter?.value;
      const list = $(`[data-tier-list="${tier}"]`, page);
      const item = form.closest('[data-tier-item]');
      if (!list || !item) return;
      event.preventDefault();
      $('details', item)?.removeAttribute('open');
      glide(() => list.append(item), null);
      item.animate?.([{ transform: 'scale(0.6)', opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
      moved(item, list);
    }));

    // Dragging: a floating copy follows the pointer and the real cover moves between the others as a placeholder.
    let drag = null;
    let frame = 0;
    const place = (event) => {
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const list = under?.closest('[data-tier-list]');
      if (!list || !page.contains(list)) return;
      const others = $$('[data-tier-item]', list).filter((item) => item !== drag.item);
      const next = others.find((item) => {
        const box = item.getBoundingClientRect();
        return event.clientY < box.bottom && (event.clientY < box.top || event.clientX < box.left + box.width / 2);
      }) || null;
      if (drag.item.parentElement === list && drag.item.nextElementSibling === next) return;
      glide(() => list.insertBefore(drag.item, next), drag.item);
      drag.list = list;
    };
    const follow = () => {
      frame = 0;
      if (!drag?.ghost) return;
      drag.ghost.style.transform = `translate3d(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px, 0) rotate(-4deg) scale(1.08)`;
    };
    page.addEventListener('pointerdown', (event) => {
      const item = event.target.closest('[data-tier-item]');
      if (!item || event.button !== 0 || event.target.closest('details')) return;
      drag = { item, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId, ghost: null };
    });
    document.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.ghost) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
        const box = drag.item.getBoundingClientRect();
        drag.offsetX = drag.startX - box.left;
        drag.offsetY = drag.startY - box.top;
        drag.ghost = drag.item.cloneNode(true);
        drag.ghost.classList.add('tier-ghost');
        drag.ghost.removeAttribute('data-tier-item');
        drag.ghost.style.width = `${box.width}px`;
        drag.ghost.setAttribute('aria-hidden', 'true');
        document.body.append(drag.ghost);
        drag.item.classList.add('is-dragging');
        board.classList.add('is-sorting');
      }
      event.preventDefault();
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (!frame) frame = window.requestAnimationFrame(follow);
      place(event);
    });
    const finish = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const { item, ghost, list } = drag;
      drag = null;
      if (!ghost) return;
      ghost.remove();
      item.classList.remove('is-dragging');
      board.classList.remove('is-sorting');
      moved(item, list || item.closest('[data-tier-list]'));
    };
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  })();

  function setUpTierImage(board) {
    const button = $('[data-tier-image]');
    const canvas = document.createElement('canvas');
    if (!button || !canvas.getContext || !canvas.toBlob) return;
    button.hidden = false;
    const COLOURS = { s: '#ff7a8a', a: '#ffb26b', b: '#ffe066', c: '#8be28b', d: '#7cc4ff' };
    button.addEventListener('click', () => {
      const width = 1200;
      const label = 140;
      const cover = { w: 84, h: 126, gap: 10 };
      const perRow = Math.floor((width - label - 40) / (cover.w + cover.gap));
      const rows = $$('[data-tier-row]', board).map((row) => ({
        tier: row.dataset.tierRow,
        images: $$('[data-tier-item] img', row),
      }));
      const heights = rows.map((row) => Math.max(1, Math.ceil(row.images.length / perRow)) * (cover.h + cover.gap) + cover.gap);
      canvas.width = width;
      canvas.height = 90 + heights.reduce((sum, height) => sum + height, 0) + 50;
      const context = canvas.getContext('2d');
      context.fillStyle = '#070b14';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff';
      context.font = '700 30px system-ui, sans-serif';
      context.fillText(`${board.dataset.owner}'s tier list`, 24, 54);
      let top = 80;
      rows.forEach((row, index) => {
        context.fillStyle = COLOURS[row.tier];
        context.fillRect(20, top, label - 20, heights[index] - 6);
        context.fillStyle = '#0b0f19';
        context.font = '800 46px system-ui, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(row.tier.toUpperCase(), 20 + (label - 20) / 2, top + (heights[index] - 6) / 2);
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        context.fillStyle = 'rgba(255, 255, 255, 0.04)';
        context.fillRect(label + 6, top, width - label - 26, heights[index] - 6);
        row.images.forEach((image, position) => {
          const x = label + 16 + (position % perRow) * (cover.w + cover.gap);
          const y = top + cover.gap + Math.floor(position / perRow) * (cover.h + cover.gap);
          try {
            if (image.complete && image.naturalWidth) context.drawImage(image, x, y, cover.w, cover.h);
          } catch {
            // A cover that cannot be drawn leaves its slot empty.
          }
        });
        top += heights[index];
      });
      context.fillStyle = 'rgba(255, 255, 255, 0.55)';
      context.font = '500 16px system-ui, sans-serif';
      context.fillText('Made with Checkpoint', 24, canvas.height - 20);
      canvas.toBlob((blob) => {
        if (!blob) {
          showToast('The picture could not be made.', 'error');
          return;
        }
        const link = element('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'checkpoint-tier-list.png';
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      }, 'image/png');
    });
  }

  /* Versus: each side wears its game's colour, and the result can be copied as a link. ---------------------- */

  (function setUpVersus() {
    const page = $('.versus-page');
    if (!page) return;
    $$('[data-versus-fighter]').forEach((fighter) => {
      const cover = $('img', fighter);
      const side = fighter.dataset.versusFighter;
      if (!cover || !['left', 'right'].includes(side)) return;
      const apply = () => {
        const colour = vividColour(cover);
        if (colour) page.style.setProperty(`--${side}-accent`, brighten(colour).join(' '));
      };
      if (cover.complete && cover.naturalWidth > 0) apply();
      else cover.addEventListener('load', apply, { once: true });
    });

    const copy = $('[data-copy-link]');
    if (copy && navigator.clipboard?.writeText) {
      copy.hidden = false;
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          showToast('Link copied. Send it to settle the argument.', 'success');
        } catch {
          showToast('The link could not be copied.', 'error');
        }
      });
    }
  })();
})();

// Keep native radios for keyboard navigation and normal form submission.
document.querySelectorAll('[data-swipe-rating]').forEach((control) => {
  const stars = control.querySelector('.swipe-stars');
  const output = control.querySelector('output');
  let pointerId = null;
  function refresh() {
    const selected = control.querySelector('input:checked');
    const value = Number(selected?.value || 0);
    stars.style.setProperty('--rating-fill', `${value * 20}%`);
    output.textContent = value ? `${value} / 5` : 'Not rated';
  }
  function selectAt(event) {
    const bounds = stars.getBoundingClientRect();
    const value = Math.max(0.5, Math.min(5, Math.ceil((event.clientX - bounds.left) / bounds.width * 10) / 2));
    const input = stars.querySelector(`input[value="${value}"]`);
    input.checked = true;
    input.focus({ preventScroll: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  stars.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    pointerId = event.pointerId;
    stars.setPointerCapture(pointerId);
    selectAt(event);
    event.preventDefault();
  });
  stars.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointerId) selectAt(event);
  });
  stars.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointerId) return;
    selectAt(event);
    pointerId = null;
  });
  stars.addEventListener('pointercancel', () => { pointerId = null; });
  stars.addEventListener('lostpointercapture', () => { pointerId = null; });
  control.addEventListener('change', refresh);
  control.closest('form').addEventListener('reset', () => { setTimeout(refresh, 0); });
  refresh();
});
