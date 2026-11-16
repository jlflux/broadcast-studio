// Starting documents, shared by the browser and the API (lib/defaults.js re-exports this file).
export const SPORTS = ['football', 'basketball'];

export const clock = ms => ({ms, end: 0});

export function freshGame(sport, settings) {
  const s = settings[sport];
  if (sport === 'football') {
    return {
      score: [0, 0], timeouts: [s.timeouts, s.timeouts], period: '1st', possession: -1,
      game: clock(s.minutes * 60000), aux: clock(s.playClock * 1000), showAux: false, showClock: true,
      down: 1, distance: '10', ballOn: '', status: '',
    };
  }
  return {
    score: [0, 0], timeouts: [s.timeouts, s.timeouts], fouls: [0, 0], period: '1st', arrow: -1, possession: -1,
    game: clock(s.minutes * 60000), aux: clock(s.shotClock * 1000), showAux: false, showClock: true, status: '',
  };
}

export const defaultSettings = () => ({
  football: {minutes: 12, timeouts: 3, playClock: 40},
  basketball: {minutes: 8, timeouts: 5, shotClock: 35, bonusAt: 5, otMinutes: 4},
});

export const defaultStyle = () => ({
  layout: 'broadcast',       // 'broadcast' wide bar | 'ribbon' slim bar | 'corner' compact box
  position: 'bottom-center', // top-left, top-center, top-right, bottom-left, bottom-center, bottom-right
  scale: 100, nudgeX: 0, nudgeY: 0,
  names: 'name',             // 'name' | 'short'
  showRecords: false,
  showRank: true,
  graphicPlacement: 'auto',  // 'auto' | 'stack' (attached to bug) | 'lower-left' | 'lower-center'
  bannerSeconds: 8,
  dark: '#101722',           // bug chrome color
  accent: '#f2a900',         // studio accent (banners, ticker label)
  panel: '#f2f4f7',          // ribbon layout name plates
});

export function defaultLive() {
  const settings = defaultSettings();
  return {
    schema: 2,
    sport: 'football',
    bugVisible: true,
    teams: [
      {name: 'Eastside', short: 'EAS', rank: '', record: '', color: '#1d3f8f', accent: '#f2a900', logo: ''},
      {name: 'Westview', short: 'WES', rank: '', record: '', color: '#8f1d2c', accent: '#d9d9d9', logo: ''},
    ],
    settings,
    style: defaultStyle(),
    games: {football: freshGame('football', settings), basketball: freshGame('basketball', settings)},
    banner: null,
    graphic: null,
  };
}

export function defaultTicker() {
  return {
    visible: false,
    layout: 'corner', corner: 'top-right', edgeMargin: 40,
    title: 'SCORES', accentColor: '#f2a900', winnerColor: '#ffd200',
    secondsPerGame: 6, refreshSeconds: 20,
    showLogos: true, showRecords: false, showRankings: true, showUpcoming: true,
    hideWhenEmpty: true, emptyMessage: 'Scores coming up',
    includeLive: false, liveLabel: 'THIS GAME',
    sheets: [],               // [{label, url}] Google Sheets in the ticker's template format
    leagues: [], teams: [],   // ESPN feeds + team filter
    games: [],                // hand-entered: {league, away, awayScore, home, homeScore, status, show}
  };
}

export function defaultLibrary() {
  return {teams: [], rosters: [], presets: [], serialProfiles: []};
}

export function defaultStats() {
  return {schema: 1, sport: 'football', teams: [{players: []}, {players: []}], events: [], autoSend: true, startedAt: 0};
}

export const DEFAULT_DOCS = {live: defaultLive, ticker: defaultTicker, library: defaultLibrary, stats: defaultStats};
