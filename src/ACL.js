import Id from './Id';
import jute from './jute';
import Permission from './Permission';

function ACL(permission, id) {
  if (typeof permission !== 'number' || permission < 1 || permission > 31) {
    throw new Error('permission must be a valid integer.');
  }

  if (!(id instanceof Id)) {
    throw new Error('id must be an instance of Id class.');
  }

  this.permission = permission;
  this.id = id;
}

ACL.prototype.toRecord = function() {
  return new jute.data.ACL(this.permission, this.id.toRecord());
};

const ACLS = {
  OPEN_ACL_UNSAFE: [new ACL(Permission.ALL, Id.ANYONE_ID_UNSAFE)],
  CREATOR_ALL_ACL: [new ACL(Permission.ALL, Id.AUTH_IDS)],
  READ_ACL_UNSAFE: [new ACL(Permission.READ, Id.ANYONE_ID_UNSAFE)],
};

function fromRecord(record) {
  if (!(record instanceof jute.data.ACL)) {
    throw new Error('record must be an instace of jute.data.ACL.');
  }

  return new ACL(record.perms, Id.fromRecord(record.id));
}

module.exports = ACL;
module.exports.fromRecord = fromRecord;
Object.keys(ACLS).forEach(key => {
  module.exports[key] = ACLS[key];
});
