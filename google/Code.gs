const TABLES = ['Members', 'Titles', 'Activity'];
const TYPES = ['Movie', 'Series', 'Documentary', 'Miniseries', 'Anime', 'Other'];

const ROOT_FOLDER_ID = '1Am3JAoZG-3FJ2fS4pH2YsUrS6s83svhq';

function doPost(event) {
  let result;
  try {
    const request = JSON.parse(event.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
    if (!secret || typeof request.secret !== 'string' || !sameSecret_(secret, request.secret)) {
      return json_({ok:false, error:'Google backend authentication failed.'});
    }
    const actions = {getState, addMember, saveTitle, setStatus, getPoster};
    if (!Object.prototype.hasOwnProperty.call(actions, request.method) || !Array.isArray(request.args)) {
      return json_({ok:false, error:'Unknown operation.'});
    }
    result = {ok:true, data:actions[request.method](...request.args)};
  } catch (error) {
    result = {ok:false, error:error.message || 'Google storage request failed.'};
  }
  return json_(result);
}

function json_(result) {
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function sameSecret_(expected, received) {
  const a = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, expected);
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, received);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

// Run from the Apps Script editor as the owner.
function setupPL4YOU() {
  return locked_(() => {
    const props = PropertiesService.getScriptProperties();
    const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    let sheetId = props.getProperty('SHEET_ID');
    let folderId = props.getProperty('FOLDER_ID');
    if (!sheetId) {
      sheetId = SpreadsheetApp.create('PL4YOU • Database').getId();
      props.setProperty('SHEET_ID', sheetId);
    }
    const databaseFile = DriveApp.getFileById(sheetId);
    if (!hasParent_(databaseFile, ROOT_FOLDER_ID)) databaseFile.moveTo(root);
    if (!folderId) {
      folderId = root.createFolder('PL4YOU • Posters').getId();
      props.setProperty('FOLDER_ID', folderId);
    }
    const posters = DriveApp.getFolderById(folderId);
    if (!hasParent_(posters, ROOT_FOLDER_ID)) posters.moveTo(root);
    const book = SpreadsheetApp.openById(sheetId);
    TABLES.forEach(name => {
      if (!book.getSheetByName(name)) {
        const sheet = book.insertSheet(name);
        sheet.appendRow(['ID', 'Record (JSON)']);
        sheet.setFrozenRows(1);
      }
    });
    console.log('Database: ' + book.getUrl());
    console.log('Posters: ' + posters.getUrl());
  });
}

function hasParent_(file, folderId) {
  const parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folderId) return true;
  return false;
}

function locked_(work) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const result = work();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function database_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('The owner needs to run setupPL4YOU in Apps Script.');
  return SpreadsheetApp.openById(id);
}

function read_(book, name) {
  const sheet = book.getSheetByName(name);
  const count = sheet.getLastRow() - 1;
  if (count <= 0) return [];
  return sheet.getRange(2, 1, count, 2).getValues()
    .map(([id, json], index) => ({id, json, row: index + 2}))
    .filter(record => record.id && record.json)
    .map(record => ({...JSON.parse(record.json), row: record.row}));
}

function state_(book) {
  return Object.fromEntries(TABLES.map(name => [
    name.toLowerCase(), read_(book, name).map(({row, ...record}) => record)
  ]));
}

function getState() {
  return locked_(() => state_(database_()));
}

function save_(book, name, record, row) {
  const sheet = book.getSheetByName(name);
  const values = [record.id, JSON.stringify(record)];
  if (row) sheet.getRange(row, 1, 1, 2).setValues([values]);
  else sheet.appendRow(values);
}

function clean_(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function rating_(value, min, max, integer) {
  if (value === '' || value == null) return '';
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max ||
      (integer && !Number.isInteger(number))) throw new Error('Check the rating ranges.');
  return number;
}

function member_(members, id) {
  if (!members.some(member => member.id === id)) throw new Error('Select a valid member.');
}

function addMember(name) {
  name = clean_(name, 60);
  if (!name) throw new Error('Enter a name.');
  return locked_(() => {
    const book = database_();
    const members = read_(book, 'Members');
    let member = members.find(entry => entry.name.toLowerCase() === name.toLowerCase());
    if (!member) {
      member = {id: Utilities.getUuid(), name};
      save_(book, 'Members', member);
    }
    return {id: member.id, state: state_(book)};
  });
}

function saveTitle(data) {
  return locked_(() => {
    const book = database_();
    const members = read_(book, 'Members');
    const existing = data.id ? read_(book, 'Titles').find(item => item.id === data.id) : null;
    if (data.id && !existing) throw new Error('Title could not be found.');
    const name = clean_(data.name, 160);
    if (!name) throw new Error('Enter a title name.');
    const trailer = clean_(data.trailer, 1000);
    if (trailer && !/^https?:\/\/[^\s]+$/i.test(trailer)) throw new Error('Enter a valid trailer link.');
    const recommended = clean_(data.recommended, 80);
    if (recommended) member_(members, recommended);
    const completed = Array.isArray(data.completed) ? [...new Set(data.completed)] : [];
    completed.forEach(id => member_(members, id));
    const title = {
      id: existing ? existing.id : Utilities.getUuid(),
      name, trailer, type: TYPES.includes(data.type) ? data.type : '',
      genre: clean_(data.genre, 250),
      imdb: rating_(data.imdb, 0, 10, false),
      tomatoes: rating_(data.tomatoes, 0, 100, true),
      stars: rating_(data.stars, 1, 5, true),
      summary: clean_(data.summary, 4000), opinion: clean_(data.opinion, 4000),
      recommended, poster: existing ? existing.poster : ''
    };
    // The completion picker only adds completions. Use My List to undo one.
    if (data.posterData) {
      const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(data.posterData);
      if (!match || match[2].length > 1400000) throw new Error('Use a JPG, PNG, WebP, or GIF under 1 MB.');
      const folderId = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
      const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1],
        title.id + '.' + match[1].split('/')[1]);
      title.poster = DriveApp.getFolderById(folderId).createFile(blob).getId();
    }
    try {
      save_(book, 'Titles', title, existing && existing.row);
      SpreadsheetApp.flush();
    } catch (error) {
      if (data.posterData && title.poster) {
        try { DriveApp.getFileById(title.poster).setTrashed(true); } catch (_) {}
      }
      throw error;
    }
    if (existing && existing.poster && existing.poster !== title.poster) {
      try { DriveApp.getFileById(existing.poster).setTrashed(true); } catch (_) {}
    }
    const activity = read_(book, 'Activity');
    completed.forEach(id => writeStatus_(book, activity, id, title.id, 'watched'));
    return state_(book);
  });
}

function writeStatus_(book, activity, memberId, titleId, status) {
  const id = memberId + ':' + titleId;
  const entry = activity.find(item => item.id === id);
  save_(book, 'Activity', {id, memberId, titleId, status}, entry && entry.row);
}

function setStatus(memberId, titleId, status) {
  if (!['queued', 'watched', 'passed', ''].includes(status)) throw new Error('Unknown watch status.');
  return locked_(() => {
    const book = database_();
    member_(read_(book, 'Members'), memberId);
    if (!read_(book, 'Titles').some(item => item.id === titleId)) throw new Error('Title could not be found.');
    writeStatus_(book, read_(book, 'Activity'), memberId, titleId, status);
    return state_(book);
  });
}

function getPoster(titleId) {
  const title = read_(database_(), 'Titles').find(item => item.id === titleId);
  if (!title || !title.poster) return '';
  const blob = DriveApp.getFileById(title.poster).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}
