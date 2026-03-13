// src/constants/mockData.ts
import { Track, Playlist, MoodPill } from '../types';

export const MOCK_TRACKS: Track[] = [
  { id:'1', emoji:'🎷', name:'Round Midnight',     artist:'Thelonious Monk',  duration:'5:32', gradientStart:'#1a3020', gradientEnd:'#0e2018', album:'Brilliant Corners',  year:1957, bpm:72, genre:['Jazz','Bebop'],    liked:false },
  { id:'2', emoji:'🎹', name:'Blue in Green',      artist:'Miles Davis',      duration:'5:37', gradientStart:'#1a2035', gradientEnd:'#0e1525', album:'Kind of Blue',       year:1959, bpm:65, genre:['Jazz','Modal'],    liked:false },
  { id:'3', emoji:'🎺', name:'Autumn Leaves',      artist:'Bill Evans Trio',  duration:'8:21', gradientStart:'#2a1520', gradientEnd:'#1a0d15', album:'Portrait in Jazz',   year:1960, bpm:80, genre:['Jazz','Ballad'],   liked:true  },
  { id:'4', emoji:'🥁', name:'So What',            artist:'Miles Davis',      duration:'9:22', gradientStart:'#1e2a15', gradientEnd:'#121a0d', album:'Kind of Blue',       year:1959, bpm:90, genre:['Jazz','Cool'],     liked:false },
  { id:'5', emoji:'🎵', name:'Misty',              artist:'Erroll Garner',    duration:'3:39', gradientStart:'#251a35', gradientEnd:'#180f22', album:'Crazy and Mixed Up', year:1954, bpm:68, genre:['Jazz','Standard'], liked:false },
  { id:'6', emoji:'🎸', name:'My Funny Valentine', artist:'Chet Baker',       duration:'7:12', gradientStart:'#1a2535', gradientEnd:'#0f1822', album:'Chet Baker Sings',   year:1954, bpm:58, genre:['Jazz','Vocal'],    liked:true  },
  { id:'7', emoji:'🎻', name:'Summertime',         artist:'John Coltrane',    duration:'11:32',gradientStart:'#302010', gradientEnd:'#1e140a', album:'My Favorite Things', year:1961, bpm:55, genre:['Jazz','Standard'], liked:false },
  { id:'8', emoji:'🎷', name:'Stella by Starlight',artist:'Bill Evans',       duration:'6:44', gradientStart:'#1a2830', gradientEnd:'#0f1820', album:'Waltz for Debby',    year:1962, bpm:70, genre:['Jazz','Lyrical'],  liked:false },
  { id:'9', emoji:'🎺', name:'All Blues',          artist:'Miles Davis',      duration:'11:33',gradientStart:'#152035', gradientEnd:'#0d1422', album:'Kind of Blue',       year:1959, bpm:78, genre:['Jazz','Blues'],    liked:false },
];

export const MOCK_PLAYLISTS: Playlist[] = [
  { id:'pl1', name:'비 오는 날의 재즈',   coverEmoji:'🌧️', gradientStart:'#1a2535', gradientEnd:'#0e1822', trackCount:9,  duration:'48분',       liked:true,  tracks:MOCK_TRACKS,            createdAt:new Date('2026-03-10') },
  { id:'pl2', name:'새벽 드라이브',       coverEmoji:'🌙',  gradientStart:'#1e1535', gradientEnd:'#120d22', trackCount:7,  duration:'36분',       liked:false, tracks:MOCK_TRACKS.slice(0,7), createdAt:new Date('2026-03-08') },
  { id:'pl3', name:'카페 로파이',         coverEmoji:'☕',  gradientStart:'#2a1a10', gradientEnd:'#1a1008', trackCount:12, duration:'1시간 12분',  liked:true,  tracks:MOCK_TRACKS,            createdAt:new Date('2026-03-05') },
  { id:'pl4', name:'운동 에너지 부스트',  coverEmoji:'🏃',  gradientStart:'#2a1015', gradientEnd:'#1a0810', trackCount:15, duration:'1시간 20분',  liked:false, tracks:MOCK_TRACKS,            createdAt:new Date('2026-03-01') },
  { id:'pl5', name:'집중 모드',           coverEmoji:'📚',  gradientStart:'#101a2a', gradientEnd:'#08101a', trackCount:20, duration:'2시간',       liked:true,  tracks:MOCK_TRACKS,            createdAt:new Date('2026-02-28') },
];

export const MOOD_PILLS: MoodPill[] = [
  { id:'1', label:'☀️ 아침 루틴',          text:'상쾌한 아침, 커피 한 잔과 함께 듣기 좋은 에너지 넘치는 팝과 어쿠스틱 30분' },
  { id:'2', label:'🌙 야심한 밤 드라이브',  text:'새벽 2시 고속도로 드라이브, 몽환적이고 트립합적인 일렉트로닉 1시간' },
  { id:'3', label:'🏃 운동 집중',           text:'BPM 150 이상, 강렬한 힙합과 EDM으로 헬스장 집중 45분' },
  { id:'4', label:'📚 공부할 때',           text:'가사 없는 잔잔한 로파이와 앰비언트 뮤직 2시간' },
  { id:'5', label:'💆 힐링 타임',           text:'따뜻하고 포근한 인디 어쿠스틱, 지친 하루 끝 힐링 1시간' },
];

export const MOCK_USER = {
  id: 'u1',
  name: 'Alex Johnson',
  email: 'alex.johnson@gmail.com',
  avatarUrl: null as string | null,
  spotifyConnected: true,
  stats: { playlists: 24, tracks: 386, hours: 142, favorites: 8 },
};
