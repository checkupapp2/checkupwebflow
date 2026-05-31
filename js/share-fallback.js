const TYPES = {
  events: {
    singular: 'event',
    eyebrow: 'CheckUp event',
    missingTitle: 'Event unavailable',
    missingDescription: 'This event may be private, deleted, or not available on the web.',
  },
  courts: {
    singular: 'court',
    eyebrow: 'CheckUp court',
    missingTitle: 'Court unavailable',
    missingDescription: 'This court may be private, deleted, or not available on the web.',
  },
  profile: {
    singular: 'profile',
    eyebrow: 'CheckUp profile',
    missingTitle: 'Profile unavailable',
    missingDescription: 'This profile may be private, deleted, or not available on the web.',
  },
  posts: {
    singular: 'post',
    eyebrow: 'CheckUp post',
    missingTitle: 'Post unavailable',
    missingDescription: 'This post may be private, deleted, or not available on the web.',
  },
  brackets: {
    singular: 'bracket',
    eyebrow: 'CheckUp bracket',
    missingTitle: 'Bracket unavailable',
    missingDescription: 'This bracket may be private, deleted, or not available on the web.',
  },
  scoreboard: {
    singular: 'scoreboard',
    eyebrow: 'CheckUp scoreboard',
    missingTitle: 'Scoreboard unavailable',
    missingDescription: 'This scoreboard may be private, deleted, or not available on the web.',
  },
};

const card = document.getElementById('fallback-card');
const media = document.getElementById('media');
const eyebrow = document.getElementById('eyebrow');
const title = document.getElementById('title');
const metaList = document.getElementById('meta-list');
const description = document.getElementById('description');
const openApp = document.getElementById('open-app');

main();

async function main() {
  const route = parseRoute(window.location.pathname);
  if (!route) {
    renderUnavailable({
      eyebrowText: 'CheckUp link',
      titleText: 'Link unavailable',
      descriptionText: 'This CheckUp link is not supported on the web.',
      appUrl: 'checkup://',
    });
    return;
  }

  const config = TYPES[route.type];
  const appUrl = `checkup://${config.singular}/${encodeURIComponent(route.id)}`;
  openApp.href = appUrl;
  openApp.addEventListener('click', (event) => openAppLink(event, appUrl));

  try {
    const response = await fetch(`/api/share-preview?type=${encodeURIComponent(route.type)}&id=${encodeURIComponent(route.id)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      renderUnavailable({
        eyebrowText: config.eyebrow,
        titleText: config.missingTitle,
        descriptionText: config.missingDescription,
        appUrl,
      });
      return;
    }

    const data = await response.json();

    if (route.type === 'events') {
      renderEvent(route.id, data, appUrl);
    } else if (route.type === 'courts') {
      renderCourt(route.id, data, appUrl);
    } else if (route.type === 'profile') {
      renderProfile(route.id, data, appUrl);
    } else if (route.type === 'posts') {
      renderPost(route.id, data, appUrl);
    } else if (route.type === 'brackets') {
      renderBracket(route.id, data, appUrl);
    } else {
      renderScoreboard(route.id, data, appUrl);
    }
  } catch (error) {
    console.warn('[CheckUp share fallback]', error);
    renderUnavailable({
      eyebrowText: config.eyebrow,
      titleText: config.missingTitle,
      descriptionText: 'We could not load this link right now. Open it in the CheckUp app to continue.',
      appUrl,
    });
  }
}

function parseRoute(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const [rawType, ...rest] = segments;
  const id = decodeURIComponent(rest.join('/')).trim();
  if (!id) return null;

  if (rawType === 'event') return { type: 'events', id };
  if (rawType === 'court') return { type: 'courts', id };
  if (rawType === 'profiles') return { type: 'profile', id };
  if (rawType === 'post') return { type: 'posts', id };
  if (rawType === 'bracket') return { type: 'brackets', id };
  if (rawType === 'scoreboards' || rawType === 'score') return { type: 'scoreboard', id };
  if (TYPES[rawType]) return { type: rawType, id };
  return null;
}

function renderEvent(id, data, appUrl) {
  const image = firstString(data.bannerImageUrl, data.imageUrl, firstFromList(data.images), firstFromList(data.gallery));
  const hiddenLocation = data.locationHidden === true;
  const location = hiddenLocation ? 'Location shown in app' : firstString(data.location, data.address, formatAddress(data));
  const isFree = data.isFree === true || data.price === 0 || data.price === '0';
  const price = isFree ? 'Free' : formatPrice(data.price);
  const date = formatDate(data.dateTime);

  renderPage({
    eyebrowText: 'CheckUp event',
    titleText: firstString(data.title, data.name, 'Untitled event'),
    image,
    meta: [
      ['When', date],
      ['Where', location],
      ['Price', price],
    ],
    descriptionText: firstString(data.description, data.category, `Event ID: ${id}`),
    appUrl,
  });
}

function renderCourt(id, data, appUrl) {
  const image = firstString(data.imageUrl, firstFromList(data.images), firstFromList(data.imageUrls), firstFromList(data.photos));
  const address = formatAddress(data) || firstString(data.locationName, data.location);
  const features = Array.isArray(data.features) ? data.features.filter(Boolean).slice(0, 3).join(', ') : '';

  renderPage({
    eyebrowText: 'CheckUp court',
    titleText: firstString(data.name, 'Basketball court'),
    image,
    meta: [
      ['Location', address],
      ['Type', data.isIndoor === true ? 'Indoor' : data.isIndoor === false ? 'Outdoor' : 'Court'],
      ['Features', features],
    ],
    descriptionText: firstString(data.description, `Court ID: ${id}`),
    appUrl,
  });
}

function renderProfile(id, data, appUrl) {
  const displayName = firstString(data.fullName, data.displayName, data.name, data.username, 'CheckUp player');
  const username = cleanUsername(data.username);
  const roles = Array.isArray(data.roles) ? data.roles.filter(Boolean).join(', ') : '';
  const publicLine = firstString(data.bio, data.about, data.status, data.careerHighlights, `Profile ID: ${id}`);

  renderPage({
    eyebrowText: 'CheckUp profile',
    titleText: displayName,
    image: firstString(data.photoUrl, data.avatarUrl, data.profileImageUrl, data.imageUrl),
    meta: [
      ['Username', username],
      ['Location', firstString(data.location, data.checkedInAt)],
      ['Role', firstString(data.profileType, roles, data.skillLevel)],
    ],
    descriptionText: publicLine,
    appUrl,
  });
}

function renderPost(id, data, appUrl) {
  const image = firstString(data.imageUrl, firstFromList(data.imageUrls), data.videoThumbnailUrl);

  renderPage({
    eyebrowText: 'CheckUp post',
    titleText: firstString(data.username, 'CheckUp post'),
    image,
    meta: [
      ['Posted', formatDate(data.createdAt)],
      ['Type', data.postType],
      ['Likes', data.likesCount],
    ],
    descriptionText: firstString(data.content, `Post ID: ${id}`),
    appUrl,
  });
}

function renderBracket(id, data, appUrl) {
  renderPage({
    eyebrowText: 'CheckUp bracket',
    titleText: firstString(data.name, 'Tournament bracket'),
    image: data.imageUrl,
    meta: [
      ['Starts', formatDate(data.startDate)],
      ['Teams', data.participantCount],
      ['Status', data.status],
      ['Location', data.location],
    ],
    descriptionText: firstString(data.description, `Bracket ID: ${id}`),
    appUrl,
  });
}

function renderScoreboard(id, data, appUrl) {
  const homeName = firstString(data.homeTeam?.name, 'Home');
  const awayName = firstString(data.awayTeam?.name, 'Away');
  const score = `${homeName} ${Number(data.homeTeam?.score) || 0} - ${Number(data.awayTeam?.score) || 0} ${awayName}`;

  renderPage({
    eyebrowText: 'CheckUp scoreboard',
    titleText: firstString(data.title, score),
    image: firstString(data.homeTeam?.logoUrl, data.awayTeam?.logoUrl),
    meta: [
      ['Score', score],
      ['Status', data.status],
      ['Period', data.currentPeriod],
      ['Updated', formatDate(data.updatedAt)],
    ],
    descriptionText: firstString(data.gameType, `Scoreboard ID: ${id}`),
    appUrl,
  });
}

function renderPage({ eyebrowText, titleText, image, meta, descriptionText, appUrl }) {
  card.classList.remove('is-error');
  eyebrow.textContent = eyebrowText;
  title.textContent = titleText;
  description.textContent = descriptionText || '';
  openApp.href = appUrl;
  openApp.dataset.appUrl = appUrl;
  renderImage(image);
  renderMeta(meta);
  document.title = `${titleText} | CheckUp`;
  setMetaDescription(descriptionText || 'Open this shared CheckUp basketball link.');
}

function renderUnavailable({ eyebrowText, titleText, descriptionText, appUrl }) {
  card.classList.add('is-error');
  eyebrow.textContent = eyebrowText;
  title.textContent = titleText;
  description.textContent = descriptionText;
  openApp.href = appUrl;
  openApp.dataset.appUrl = appUrl;
  media.className = 'media media-empty';
  media.style.backgroundImage = '';
  metaList.innerHTML = '';
  document.title = `${titleText} | CheckUp`;
  setMetaDescription(descriptionText);
}

function renderImage(url) {
  if (!url) {
    media.className = 'media media-empty';
    media.style.backgroundImage = '';
    return;
  }

  media.className = 'media';
  media.style.backgroundImage = `url("${cssUrl(url)}")`;
}

function renderMeta(items) {
  metaList.innerHTML = '';
  items
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'meta-item';

      const labelEl = document.createElement('span');
      labelEl.className = 'meta-label';
      labelEl.textContent = label;

      const valueEl = document.createElement('span');
      valueEl.textContent = String(value);

      row.append(labelEl, valueEl);
      metaList.append(row);
    });
}

function openAppLink(event, appUrl) {
  event.preventDefault();
  window.location.href = appUrl;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function firstFromList(value) {
  return Array.isArray(value) ? firstString(...value) : '';
}

function formatAddress(data) {
  const parts = [
    data.address,
    [data.city, data.state].filter(Boolean).join(', '),
    data.zipCode,
  ].map((part) => (typeof part === 'string' ? part.trim() : '')).filter(Boolean);
  return parts.join(' ');
}

function formatDate(value) {
  const date = firestoreDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function firestoreDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function formatPrice(value) {
  const amount = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(amount)) return 'Paid';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

function cleanUsername(value) {
  const username = firstString(value);
  if (!username) return '';
  return username.startsWith('@') ? username : `@${username}`;
}

function cssUrl(url) {
  return String(url).replaceAll('"', '%22').replaceAll('\\', '%5C');
}

function setMetaDescription(value) {
  const meta = document.querySelector('meta[name="description"]');
  if (meta && value) meta.setAttribute('content', value.slice(0, 160));
}
