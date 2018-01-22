import jute from './jute';

function Id(scheme, id) {
  if (!scheme || typeof scheme !== 'string') {
    throw new Error('scheme must be a non-empty string.');
  }

  if (typeof id !== 'string') {
    throw new Error('id must be a string.');
  }

  this.scheme = scheme;
  this.id = id;
}

Id.prototype.toRecord = function() {
  return new jute.data.Id(this.scheme, this.id);
};

const IDS = {
  ANYONE_ID_UNSAFE: new Id('world', 'anyone'),
  AUTH_IDS: new Id('auth', ''),
};

function fromRecord(record) {
  if (!(record instanceof jute.data.Id)) {
    throw new Error('record must be an instace of jute.data.Id.');
  }

  return new Id(record.scheme, record.id);
}

module.exports = Id;
module.exports.fromRecord = fromRecord;
Object.keys(IDS).forEach(key => {
  module.exports[key] = IDS[key];
});
