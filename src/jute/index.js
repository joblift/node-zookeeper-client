/* eslint func-names: 0 */
import assert from 'assert';
import util from 'util';

const exports = module.exports;
const jute = exports;

// Constants.
const SPECIFICATION_FILE = './specification.json';
const PROTOCOL_VERSION = 0;

const OP_CODES = {
  NOTIFICATION: 0,
  CREATE: 1,
  DELETE: 2,
  EXISTS: 3,
  GET_DATA: 4,
  SET_DATA: 5,
  GET_ACL: 6,
  SET_ACL: 7,
  GET_CHILDREN: 8,
  SYNC: 9,
  PING: 11,
  GET_CHILDREN2: 12,
  CHECK: 13,
  MULTI: 14,
  AUTH: 100,
  SET_WATCHES: 101,
  SASL: 102,
  CREATE_SESSION: -10,
  CLOSE_SESSION: -11,
  ERROR: -1,
};

const XID_NOTIFICATION = -1;
const XID_PING = -2;
const XID_AUTHENTICATION = -4;
// const XID_SET_WATCHES = -8;

/**
 * The prototype class for all Zookeeper jute protocol classes.
 *
 * // TODO: Move it out
 *
 * @class Record
 * @constructor
 * @param specification {Array} The array of record attribute specification.
 * @param args {Array} The constructor array of the Record class.
 */
function Record(specification, args = []) {
  if (!Array.isArray(specification)) {
    throw new Error('specification must be a valid Array.');
  }

  this.specification = specification;
  this.chrootPath = undefined;

  let match;

  this.specification.forEach((attribute, index) => {
    switch (attribute.type) {
      case 'int':
        if (typeof args[index] === 'number') {
          this[attribute.name] = args[index];
        } else {
          this[attribute.name] = 0;
        }
        break;
      case 'long':
        // Long is represented by a buffer of 8 bytes in big endian since
        // Javascript does not support native 64 integer.
        this[attribute.name] = new Buffer(8);

        if (Buffer.isBuffer(args[index])) {
          args[index].copy(this[attribute.name]);
        } else {
          this[attribute.name].fill(0);
        }
        break;
      case 'buffer':
        if (Buffer.isBuffer(args[index])) {
          this[attribute.name] = new Buffer(args[index].length);
          args[index].copy(this[attribute.name]);
        } else {
          this[attribute.name] = undefined;
        }
        break;
      case 'ustring':
        if (typeof args[index] === 'string') {
          this[attribute.name] = args[index];
        } else {
          this[attribute.name] = undefined;
        }
        break;
      case 'boolean':
        if (typeof args[index] === 'boolean') {
          this[attribute.name] = args[index];
        } else {
          this[attribute.name] = false;
        }
        break;
      default:
        if ((match = /^vector<([\w.]+)>$/.exec(attribute.type)) !== null) {
          if (Array.isArray(args[index])) {
            this[attribute.name] = args[index];
          } else {
            this[attribute.name] = undefined;
          }
        } else if ((match = /^data\.(\w+)$/.exec(attribute.type)) !== null) {
          if (args[index] instanceof Record) {
            this[attribute.name] = args[index];
          } else {
            this[attribute.name] = new jute.data[match[1]]();
          }
        } else {
          throw new Error(`Unknown type: ${attribute.type}`);
        }
    }
  });
}

Record.prototype.setChrootPath = function(path) {
  this.chrootPath = path;
};

function byteLength(type, value) {
  let match;
  let size = 0;

  switch (type) {
    case 'int':
      size = 4;
      break;
    case 'long':
      size = 8;
      break;
    case 'buffer':
      // buffer length + buffer content
      size = 4;
      if (Buffer.isBuffer(value)) {
        size += value.length;
      }
      break;
    case 'ustring':
      // string buffer length + content
      size = 4;
      if (typeof value === 'string') {
        size += Buffer.byteLength(value);
      }
      break;
    case 'boolean':
      size = 1;
      break;
    default:
      if ((match = /^vector<([\w.]+)>$/.exec(type)) !== null) {
        // vector size + vector content
        size = 4;
        if (Array.isArray(value)) {
          value.forEach(item => {
            size += byteLength(match[1], item);
          });
        }
      } else if ((match = /^data\.(\w+)$/.exec(type)) !== null) {
        size = value.byteLength();
      } else {
        throw new Error(`Unknown type: ${type}`);
      }
  }

  return size;
}

function prependChroot(self, path) {
  if (!self.chrootPath) {
    return path;
  }

  if (path === '/') {
    return self.chrootPath;
  }

  return self.chrootPath + path;
}

/**
 * Calculate and return the size of the buffer which is need to serialize this
 * record.
 *
 * @method byteLength
 * @return {Number} The number of bytes.
 */
Record.prototype.byteLength = function() {
  let size = 0;

  this.specification.forEach(attribute => {
    let value = this[attribute.name];

    // Add the chroot path to calculate the real path.
    if (attribute.name === 'path') {
      value = prependChroot(this, value);
    }

    if (
      (attribute.name === 'dataWatches' || attribute.name === 'existWatches' || attribute.name === 'childWatches') &&
      Array.isArray(value)
    ) {
      value = value.map(path => prependChroot(this, path));
    }

    size += byteLength(attribute.type, value);
  });

  return size;
};

function serialize(type, value, buffer, offset) {
  let bytesWritten = 0;
  let length = 0;
  let match;

  switch (type) {
    case 'int':
      buffer.writeInt32BE(value, offset);
      bytesWritten = 4;
      break;
    case 'long':
      // Long is represented by a buffer of 8 bytes in big endian since
      // Javascript does not support native 64 integer.
      value.copy(buffer, offset);
      bytesWritten = 8;
      break;
    case 'buffer':
      if (Buffer.isBuffer(value)) {
        buffer.writeInt32BE(value.length, offset);
        bytesWritten = 4;

        value.copy(buffer, offset + bytesWritten);
        bytesWritten += value.length;
      } else {
        buffer.writeInt32BE(-1, offset);
        bytesWritten = 4;
      }
      break;
    case 'ustring':
      if (typeof value === 'string') {
        length = Buffer.byteLength(value);
        buffer.writeInt32BE(length, offset);
        bytesWritten = 4;

        new Buffer(value).copy(buffer, offset + bytesWritten);
        bytesWritten += length;
      } else {
        buffer.writeInt32BE(-1, offset);
        bytesWritten += 4;
      }
      break;
    case 'boolean':
      buffer.writeUInt8(value ? 1 : 0, offset);
      bytesWritten += 1;
      break;
    default:
      if ((match = /^vector<([\w.]+)>$/.exec(type)) !== null) {
        // vector size + vector content
        if (Array.isArray(value)) {
          buffer.writeInt32BE(value.length, offset);
          bytesWritten += 4;

          value.forEach(item => {
            bytesWritten += serialize(match[1], item, buffer, offset + bytesWritten);
          });
        } else {
          buffer.writeInt32BE(-1, offset);
          bytesWritten += 4;
        }
      } else if ((match = /^data\.(\w+)$/.exec(type)) !== null) {
        bytesWritten += value.serialize(buffer, offset + bytesWritten);
      } else {
        throw new Error(`Unknown type: ${type}`);
      }
  }

  return bytesWritten;
}

/**
 * Serialize the record content to a buffer.
 *
 * @method serialize
 * @param buffer {Buffer} A buffer object.
 * @param offset {Number} The offset where the write starts.
 * @return {Number} The number of bytes written.
 */
Record.prototype.serialize = function(buffer, offset) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('buffer must an instance of Node.js Buffer class.');
  }

  if (offset < 0 || offset >= buffer.length) {
    throw new Error(`offset: ${offset} is out of buffer range.`);
  }

  const size = this.byteLength();

  if (offset + size > buffer.length) {
    throw new Error('buffer does not have enough space.');
  }

  this.specification.forEach(attribute => {
    let value = this[attribute.name];

    // Add the chroot path to generate the real path.
    if (attribute.name === 'path') {
      value = prependChroot(this, value);
    }

    if (
      (attribute.name === 'dataWatches' || attribute.name === 'existWatches' || attribute.name === 'childWatches') &&
      Array.isArray(value)
    ) {
      value = value.map(path => prependChroot(this, path));
    }

    // eslint-disable-next-line
    offset += serialize(attribute.type, value, buffer, offset);
  });

  return size;
};

function deserialize(type, buffer, offset) {
  let bytesRead = 0;
  let length = 0;
  let match;
  let result;
  let value;

  switch (type) {
    case 'int':
      value = buffer.readInt32BE(offset);
      bytesRead = 4;
      break;
    case 'long':
      // Long is represented by a buffer of 8 bytes in big endian since
      // Javascript does not support native 64 integer.
      value = new Buffer(8);
      buffer.copy(value, 0, offset, offset + 8);
      bytesRead = 8;
      break;
    case 'buffer':
      length = buffer.readInt32BE(offset);
      bytesRead = 4;

      if (length === -1) {
        value = undefined;
      } else {
        value = new Buffer(length);
        buffer.copy(value, 0, offset + bytesRead, offset + bytesRead + length);

        bytesRead += length;
      }
      break;
    case 'ustring':
      length = buffer.readInt32BE(offset);
      bytesRead = 4;

      if (length === -1) {
        value = undefined;
      } else {
        value = buffer.toString('utf8', offset + bytesRead, offset + bytesRead + length);

        bytesRead += length;
      }
      break;
    case 'boolean':
      value = buffer.readUInt8(offset) === 1;
      bytesRead = 1;
      break;
    default:
      if ((match = /^vector<([\w.]+)>$/.exec(type)) !== null) {
        length = buffer.readInt32BE(offset);
        bytesRead = 4;

        if (length === -1) {
          value = undefined;
        } else {
          value = [];
          while (length > 0) {
            result = deserialize(match[1], buffer, offset + bytesRead);
            value.push(result.value);
            bytesRead += result.bytesRead;
            length -= 1;
          }
        }
      } else if ((match = /^data\.(\w+)$/.exec(type)) !== null) {
        value = new jute.data[match[1]]();
        bytesRead = value.deserialize(buffer, offset);
      } else {
        throw new Error(`Unknown type: ${type}`);
      }
  }

  return {
    value,
    bytesRead,
  };
}

/**
 * De-serialize the record content from a buffer.
 *
 * @method deserialize
 * @param buffer {Buffer} A buffer object.
 * @param offset {Number} The offset where the read starts.
 * @return {Number} The number of bytes read.
 */
Record.prototype.deserialize = function(buffer, offset) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('buffer must an instance of Node.js Buffer class.');
  }

  if (offset < 0 || offset >= buffer.length) {
    throw new Error(`offset: ${offset} is out of buffer range.`);
  }

  let bytesRead = 0;
  let result;

  this.specification.forEach(attribute => {
    result = deserialize(attribute.type, buffer, offset + bytesRead);
    this[attribute.name] = result.value;
    bytesRead += result.bytesRead;

    // Remove the chroot part from the real path.
    if (this.chrootPath && attribute.name === 'path') {
      if (this.path === this.chrootPath) {
        this.path = '/';
      } else {
        this.path = this.path.substring(this.chrootPath.length);
      }
    }
  });

  return bytesRead;
};

function TransactionRequest(ops) {
  if (!(this instanceof TransactionRequest)) {
    return new TransactionRequest(ops);
  }

  assert(Array.isArray(ops), 'ops must be a valid array.');
  this.ops = ops;
  this.records = [];

  this.ops.forEach(op => {
    const mh = new jute.protocol.MultiHeader(op.type, false, -1);
    let record;

    this.records.push(mh);

    switch (op.type) {
      case jute.OP_CODES.CREATE:
        record = new jute.protocol.CreateRequest();
        record.path = op.path;
        record.data = op.data;
        record.acl = op.acls.map(item => item.toRecord());
        record.flags = op.mode;
        break;
      case jute.OP_CODES.DELETE:
        record = new jute.protocol.DeleteRequest();
        record.path = op.path;
        record.version = op.version;
        break;
      case jute.OP_CODES.SET_DATA:
        record = new jute.protocol.SetDataRequest();
        record.path = op.path;
        if (Buffer.isBuffer(op.data)) {
          record.data = new Buffer(op.data.length);
          op.data.copy(record.data);
        }
        record.version = op.version;
        break;
      case jute.OP_CODES.CHECK:
        record = new jute.protocol.CheckVersionRequest();
        record.path = op.path;
        record.version = op.version;
        break;
      default:
        throw new Error(`Unknown op type: ${op.type}`);
    }

    this.records.push(record);
  }, this);

  // Signal the end of the ops.
  this.records.push(new jute.protocol.MultiHeader(-1, true, -1));
}

TransactionRequest.prototype.setChrootPath = function(path) {
  this.records.forEach(record => {
    record.setChrootPath(path);
  });
};

TransactionRequest.prototype.byteLength = function() {
  return this.records.reduce((length, record) => length + record.byteLength(), 0);
};

TransactionRequest.prototype.serialize = function(buffer, offset) {
  assert(Buffer.isBuffer(buffer), 'buffer must an instance of Node.js Buffer class.');

  assert(offset >= 0 && offset < buffer.length, `offset: ${offset} is out of buffer range.`);

  const size = this.byteLength();

  if (offset + size > buffer.length) {
    throw new Error('buffer does not have enough space.');
  }

  this.records.forEach(record => {
    // eslint-disable-next-line
    offset += record.serialize(buffer, offset);
  });

  return size;
};

function TransactionResponse() {
  if (!(this instanceof TransactionResponse)) {
    return new TransactionResponse();
  }

  this.results = [];
  this.chrootPath = undefined;
}

TransactionResponse.prototype.setChrootPath = function(path) {
  this.chrootPath = path;
};

TransactionResponse.prototype.deserialize = function(buffer, offset) {
  assert(Buffer.isBuffer(buffer), 'buffer must an instance of Node.js Buffer class.');

  assert(offset >= 0 && offset < buffer.length, `offset: ${offset} is out of buffer range.`);

  let bytesRead = 0;
  let header;
  let response;

  // eslint-disable-next-line
  while (true) {
    // eslint-disable-line no-constant-condition
    header = new jute.protocol.MultiHeader();
    bytesRead += header.deserialize(buffer, offset + bytesRead);

    if (header.done) {
      break;
    }

    switch (header.type) {
      case jute.OP_CODES.CREATE:
        response = new jute.protocol.CreateResponse();
        response.setChrootPath(this.chrootPath);
        bytesRead += response.deserialize(buffer, offset + bytesRead);
        this.results.push({
          type: header.type,
          path: response.path,
        });
        break;
      case jute.OP_CODES.DELETE:
        this.results.push({
          type: header.type,
        });
        break;
      case jute.OP_CODES.SET_DATA:
        response = new jute.protocol.SetDataResponse();
        response.setChrootPath(this.chrootPath);
        bytesRead += response.deserialize(buffer, offset + bytesRead);
        this.results.push({
          type: header.type,
          stat: response.stat,
        });
        break;
      case jute.OP_CODES.CHECK:
        this.results.push({
          type: header.type,
        });
        break;
      case jute.OP_CODES.ERROR:
        response = new jute.protocol.ErrorResponse();
        response.setChrootPath(this.chrootPath);
        bytesRead += response.deserialize(buffer, offset + bytesRead);
        this.results.push({
          type: header.type,
          err: response.err,
        });
        break;
      default:
        throw new Error(`Unknown type: ${header.type} in transaction response.`);
    }
  }

  return bytesRead;
};

/**
 * This class represent the request the client sends over the wire to ZooKeeper
 * server.
 *
 * @class Request
 * @constructor
 * @param header {Record} The request header record.
 * @param payload {payload} The request payload record.
 */
function Request(header, payload) {
  this.header = header;
  this.payload = payload;
}

/**
 * Serialize the request to a buffer.
 * @method toBuffer
 * @return {Buffer} The buffer which contains the serialized request.
 */
Request.prototype.toBuffer = function() {
  let offset = 0;
  let size = 0;

  if (this.header) {
    size += this.header.byteLength();
  }

  if (this.payload) {
    size += this.payload.byteLength();
  }

  // Needs 4 extra for the length field (Int32)
  const buffer = new Buffer(size + 4);

  buffer.writeInt32BE(size, offset);
  offset += 4;

  if (this.header) {
    offset += this.header.serialize(buffer, offset);
  }

  if (this.payload) {
    offset += this.payload.serialize(buffer, offset);
  }

  return buffer;
};

/**
 * This class represent the response that ZooKeeper sends back to the client.
 *
 * @class Responsee
 * @constructor
 * @param header {Record} The request header record.
 * @param payload {payload} The request payload record.
 */
function Response(header, payload) {
  this.header = header;
  this.payload = payload;
}

/**
 * Generate a Protocol class according to the specification.
 * @for module.jute
 * @method generateClass
 */
function generateClass(specification, moduleName, className) {
  const spec = specification[moduleName][className];

  function constructor(...args) {
    Record.call(this, spec, Array.prototype.slice.call(args, 0));
  }

  util.inherits(constructor, Record);

  return constructor;
}

// Exports constants
exports.PROTOCOL_VERSION = PROTOCOL_VERSION;
exports.OP_CODES = OP_CODES;

exports.XID_NOTIFICATION = XID_NOTIFICATION;
exports.XID_PING = XID_PING;
exports.XID_AUTHENTICATION = XID_AUTHENTICATION;

// Exports classes
exports.Request = Request;
exports.Response = Response;

// TODO: Consider move to protocol namespace
exports.TransactionRequest = TransactionRequest;
exports.TransactionResponse = TransactionResponse;

// Automatically generates and exports all protocol and data classes.
const specification = require(SPECIFICATION_FILE);

Object.keys(specification).forEach(moduleName => {
  // Modules like protocol or data.
  exports[moduleName] = exports[moduleName] || {};

  Object.keys(specification[moduleName]).forEach(className => {
    exports[moduleName][className] = generateClass(specification, moduleName, className);
  });
});
