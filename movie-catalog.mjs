import { readFile } from 'node:fs/promises';

export const movieSnapshotUrl = new URL('./data/movies.json', import.meta.url);
const archive = 'https://archive.org';
const livingDead = 'night_of_the_living_dead_ipod';

function text(value) {
  return (Array.isArray(value) ? value.join(', ') : String(value ?? '')).replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function filmTitle(rawTitle, year) {
  const cleaned = text(rawTitle).replace(/\biPod(?: and Flash video versions?| version)?\b/gi, '').trim();
  if (cleaned.startsWith(year + ' ')) return cleaned.slice(5).trim();
  const yearAt = cleaned.search(new RegExp('\\b' + year + '\\b'));
  const name = yearAt > 0 ? cleaned.slice(0, yearAt) : cleaned;
  return name.replace(/[\s([.–_-]+$/, '').replace(/\s+\(complete & clearer\)$/i, '').trim();
}

export function titleKey(movie) {
  return movie.title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') + '/' + movie.year;
}

function selectFile(files) {
  const videos = (files || []).filter(file => /\.mp4$/i.test(file.name) && String(file.private).toLowerCase() !== 'true' &&
    Number(file.length) >= 2400 && Number(file.size) > 1_000_000 &&
    !/trailer|sample|excerpt|\b(?:part|chapter|episode)[ _-]*\d+\b/i.test(file.name));
  // Among feature-length files prefer a complete runtime, then the better resolution
  // of that cut. This keeps trailers and shorter samples out of a movie's source menu.
  const longest = Math.max(0, ...videos.map(file => Number(file.length)));
  const compatibility = file => {
    if (/^h\.264(?: IA)?$/i.test(file.format || '')) return 2;
    if (/x265|h[.-]?265|hevc/i.test(file.name) && file.source === 'original') return 0;
    return 1;
  };
  return videos.filter(file => file.length >= longest - 90).sort((a, b) =>
    compatibility(b) - compatibility(a) || Number(b.height || 0) - Number(a.height || 0) ||
    Number(b.size) - Number(a.size))[0];
}

function storageUrl(server, dir, identifier, file) {
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.archive\.org$/i.test(server) ||
      !/^\/\d+\/items\/[^/]+$/.test(dir) || dir.split('/').pop() !== identifier) return null;
  const segments = file.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) return null;
  return 'https://' + server + dir.slice(0, dir.lastIndexOf('/') + 1) + encodeURIComponent(identifier) + '/' + segments.map(encodeURIComponent).join('/');
}

export function movieFromMetadata(record) {
  const m = record?.metadata;
  const identifier = m?.identifier;
  if (!identifier || !/^[A-Za-z0-9_.-]+$/.test(identifier) || m.mediatype !== 'movies' ||
      String(m['access-restricted-item']).toLowerCase() === 'true') return null;
  const rawTitle = text(m.title);
  if (!rawTitle || /trailer|compilation|collection of|\bshorts\b|\b(?:episode|chapter|part)\s*[0-9]+|\b(?:colori[sz]ed|synced symphonic|sync music|synced soundtrack)\b/i.test(rawTitle)) return null;
  const year = Number(/^(\d{4})/.exec(text(m.date || m.year))?.[1]);
  if (year < 1890 || year > 1930 || !Number.isInteger(year)) {
    if (identifier !== livingDead || year !== 1968) return null;
  }
  const license = text(m.licenseurl).replace(/^http:/, 'https:');
  if (!/^https:\/\/creativecommons\.org\/(?:licenses\/publicdomain|publicdomain\/(?:mark\/1\.0|zero\/1\.0))\/?$/i.test(license)) return null;
  const file = selectFile(record.files);
  if (!file) return null;
  const loc = [
    ...(record.workable_servers || []).map(server => ({server, dir: record.dir})),
    ...(record.alternate_locations?.workable || [])
  ];
  const storage = new Map();
  for (const {server, dir} of loc) {
    const url = storageUrl(server, dir, identifier, file.name);
    if (url) storage.set(server, url);
  }
  if (storage.size < 2) return null;
  const mirrors = [...storage.values()];
  const primary = mirrors[0];
  const backup = mirrors.find(url => new URL(url).hostname.endsWith('.ca.archive.org') && url !== primary) || mirrors[1];
  const id = encodeURIComponent(identifier);
  const title = identifier === livingDead ? 'Night of the Living Dead' : filmTitle(rawTitle, year);
  if (!title) return null;
  const runtimeSeconds = Math.round(Number(file.length));
  const creator = text(m.creator).slice(0, 160);
  const tags = text(m.subject).split(/[,;]/).map(x => x.trim()).filter(Boolean).slice(0, 8).join(', ').slice(0, 160);
  const sources = [
    {key:'stream', label:'Archive stream', type:'video', url:archive + '/download/' + id + '/' + file.name.split('/').map(encodeURIComponent).join('/')},
    {key:'primary', label:'Primary server', type:'video', url:primary},
    {key:'backup', label:'Backup server', type:'video', url:backup},
    {key:'embed', label:'Archive player', type:'embed', url:archive + '/embed/' + id}
  ];
  return {
    id: 'film:' + identifier, title, kind:'movie', provider:'INTERNET ARCHIVE', cat:'CINEMA',
    year, runtimeSeconds, creator, tags, desc:[year, Math.round(runtimeSeconds / 60) + ' min', creator].filter(Boolean).join(' · '),
    thumb:archive + '/services/img/' + id, url:archive + '/details/' + id, licenseUrl:license, sources
  };
}

let catalog;
export async function getMovieCatalog() {
  if (!catalog) catalog = readFile(movieSnapshotUrl, 'utf8').then(JSON.parse).catch(error => {
    catalog = null;
    throw error;
  });
  return catalog;
}

