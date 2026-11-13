const $ = (selector) => document.querySelector(selector);
const library = $('#library');
const search = $('#search');
let videos = [];
let jobTimer;

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mediaUrl = (file) => `/media?file=${encodeURIComponent(file)}`;
const dateLabel = (value) => value && /^\d{8}$/.test(value) ? new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unknown';
const durationLabel = (seconds) => {
  if (!seconds) return '';
  const n = Math.floor(seconds); const h = Math.floor(n / 3600); const m = Math.floor((n % 3600) / 60); const s = n % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

function render() {
  const query = search.value.trim().toLowerCase();
  const shown = videos.filter((v) => `${v.title} ${v.uploader} ${v.description}`.toLowerCase().includes(query));
  $('#video-count').textContent = videos.length;
  if (!shown.length) {
    library.innerHTML = videos.length ? '<div class="empty-state"><strong>No matches</strong>Try another title or creator.</div>' : '<div class="empty-state"><strong>Your library is ready</strong>Add Facebook video links above to start building your collection.</div>';
    return;
  }
  library.innerHTML = shown.map((v) => `<article class="card" data-id="${escapeHtml(v.id)}" tabindex="0" role="button" aria-label="Play ${escapeHtml(v.title)}"><div class="thumb">${v.thumbnail ? `<img loading="lazy" src="${mediaUrl(v.thumbnail)}" alt="">` : '<span class="eyebrow">VIDEO</span>'}<span class="play">▶</span>${v.duration ? `<span class="duration">${durationLabel(v.duration)}</span>` : ''}</div><h3>${escapeHtml(v.title)}</h3><div class="card-meta"><span class="creator">${escapeHtml(v.uploader)}</span><span>${dateLabel(v.uploadDate)}</span></div></article>`).join('');
  library.querySelectorAll('.card').forEach((card) => {
    const open = () => playVideo(videos.find((v) => v.id === card.dataset.id));
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
}

function playVideo(video) {
  if (!video) return;
  $('#player').src = mediaUrl(video.video);
  $('#player-title').textContent = video.title;
  $('#player-uploader').textContent = video.uploader;
  $('#player-date').textContent = dateLabel(video.uploadDate);
  $('#player-description').textContent = video.description;
  $('#player-dialog').showModal();
  $('#player').play().catch(() => {});
}

async function loadLibrary() {
  try {
    const response = await fetch('/api/videos');
    if (!response.ok) throw new Error('Could not load library');
    videos = await response.json();
    render();
  } catch (error) { library.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}

async function loadJobs() {
  const box = $('#jobs');
  try {
    const response = await fetch('/api/jobs');
    const jobs = await response.json();
    box.innerHTML = jobs.slice(0, 8).map((job) => `<div class="job"><b>${escapeHtml(job.url)}</b>${job.itemCount > 1 ? ` · ${job.itemCount} reels` : ''} · <span class="${job.status === 'failed' ? 'failed' : ''}">${escapeHtml(job.status)}</span>${job.status === 'failed' ? ` — ${escapeHtml(job.output || 'See container logs for details.')}` : ''}</div>`).join('');
    if (jobs.some((job) => job.status === 'running' || job.status === 'queued')) {
      if (!jobTimer) jobTimer = setInterval(async () => { await loadJobs(); await loadLibrary(); }, 4000);
    } else if (jobTimer) { clearInterval(jobTimer); jobTimer = null; }
    if (jobs.some((job) => job.status === 'complete')) await loadLibrary();
  } catch { /* The service may still be starting up. */ }
}

$('#download-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const urls = $('#urls').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  button.disabled = true;
  try {
    const response = await fetch('/api/downloads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ urls }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not start download.');
    $('#urls').value = '';
    await loadJobs();
  } catch (error) { $('#jobs').innerHTML = `<div class="job failed">${escapeHtml(error.message)}</div>`; }
  finally { button.disabled = false; }
});

$('#page-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/api/pages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageUrl: $('#page-url').value.trim(), limit: Number($('#reel-limit').value) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not add page reels.');
    $('#page-url').value = '';
    await loadJobs();
  } catch (error) { $('#jobs').innerHTML = `<div class="job failed">${escapeHtml(error.message)}</div>`; }
  finally { button.disabled = false; }
});

search.addEventListener('input', render);
$('#refresh').addEventListener('click', async () => { await loadLibrary(); await loadJobs(); });
$('#close-player').addEventListener('click', () => $('#player-dialog').close());
$('#player-dialog').addEventListener('close', () => { $('#player').pause(); $('#player').removeAttribute('src'); $('#player').load(); });
loadLibrary();
loadJobs();
