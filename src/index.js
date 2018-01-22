/**
 *
 * A pure Javascript ZooKeeper client.
 *
 *
 */

import ACL from './ACL';
import assert from 'assert';
import async from 'async';
import ConnectionManager from './ConnectionManager';
import CreateMode from './CreateMode';
import Event from './Event';
import events from 'events';
import Exception from './Exception';
import Id from './Id';
import jute from './jute';
import Path from './Path';
import Permission from './Permission';
import State from './State';
import Transaction from './Transaction';
import u from 'underscore';
import util from 'util';

// Constants.
const CLIENT_DEFAULT_OPTIONS = {
  sessionTimeout: 30000, // Default to 30 seconds.
  spinDelay: 1000, // Defaults to 1 second.
  retries: 0, // Defaults to 0, no retry.
};

const DATA_SIZE_LIMIT = 1048576; // 1 mega bytes.

/**
 * Default state listener to emit user-friendly events.
 */
function defaultStateListener(state) {
  switch (state) {
    case State.DISCONNECTED:
      this.emit('disconnected');
      break;
    case State.SYNC_CONNECTED:
      this.emit('connected');
      break;
    case State.CONNECTED_READ_ONLY:
      this.emit('connectedReadOnly');
      break;
    case State.EXPIRED:
      this.emit('expired');
      break;
    case State.AUTH_FAILED:
      this.emit('authenticationFailed');
      break;
    default:
  }
}

/**
 * Try to execute the given function 'fn'. If it fails to execute, retry for
 * 'self.options.retires' times. The duration between each retry starts at
 * 1000ms and grows exponentially as:
 *
 * duration = Math.min(1000 * Math.pow(2, attempts), sessionTimeout)
 *
 * When the given function is executed successfully or max retry has been
 * reached, an optional callback function will be invoked with the error (if
 * any) and the result.
 *
 * fn prototype:
 * function(attempts, next);
 * attempts: tells you what is the current execution attempts. It starts with 0.
 * next: You invoke the next function when complete or there is an error.
 *
 * next prototype:
 * function(error, ...);
 * error: The error you encounter in the operation.
 * other arguments: Will be passed to the optional callback
 *
 * callback prototype:
 * function(error, ...)
 *
 * @private
 * @method attempt
 * @param self {Client} an instance of zookeeper client.
 * @param fn {Function} the function to execute.
 * @param callback {Function} optional callback function.
 *
 */
function attempt(self, fn, callback) {
  let count = 0;
  let retry = true;
  const retries = self.options.retries;
  const results = {};

  assert(typeof fn === 'function', 'fn must be a function.');

  assert(typeof retries === 'number' && retries >= 0, 'retries must be an integer greater or equal to 0.');

  assert(typeof callback === 'function', 'callback must be a function.');

  async.whilst(
    () => count <= retries && retry,
    next => {
      const attempts = count;

      count += 1;

      fn(attempts, function(error) {
        let args;
        let sessionTimeout;

        results[attempts] = {};
        results[attempts].error = error;

        if (arguments.length > 1) {
          // eslint-disable-next-line
          args = Array.prototype.slice.apply(arguments);
          results[attempts].args = args.slice(1);
        }

        if (error && error.code === Exception.CONNECTION_LOSS) {
          retry = true;
        } else {
          retry = false;
        }

        if (!retry || count > retries) {
          // call next so we can get out the loop without delay
          // eslint-disable-next-line
          next();
        } else {
          sessionTimeout = self.connectionManager.getSessionTimeout();

          // Exponentially back-off
          setTimeout(next, Math.min(1000 * Math.pow(2, attempts), sessionTimeout));
        }
      });
    },
    (/* error */) => {
      const args = [];
      const result = results[count - 1];

      if (callback) {
        args.push(result.error);
        Array.prototype.push.apply(args, result.args);

        // eslint-disable-next-line
        callback(...args);
      }
    }
  );
}

/**
 * The ZooKeeper client constructor.
 *
 * @class Client
 * @constructor
 * @param connectionString {String} ZooKeeper server ensemble string.
 * @param [options] {Object} client options.
 */
function Client(connectionString, options = {}) {
  if (!(this instanceof Client)) {
    return new Client(connectionString, options);
  }

  events.EventEmitter.call(this);

  assert(connectionString && typeof connectionString === 'string', 'connectionString must be an non-empty string.');

  assert(typeof options === 'object', 'options must be a valid object');

  // eslint-disable-next-line
  options = u.defaults(u.clone(options), CLIENT_DEFAULT_OPTIONS);

  this.connectionManager = new ConnectionManager(connectionString, options, this.onConnectionManagerState.bind(this));

  this.options = options;
  this.state = State.DISCONNECTED;

  this.on('state', defaultStateListener);
}

util.inherits(Client, events.EventEmitter);

/**
 * Start the client and try to connect to the ensemble.
 *
 * @method connect
 */
Client.prototype.connect = function() {
  this.connectionManager.connect();
};

/**
 * Shutdown the client.
 *
 * @method connect
 */
Client.prototype.close = function() {
  this.connectionManager.close();
};

/**
 * Private method to translate connection manager state into client state.
 */
Client.prototype.onConnectionManagerState = function(connectionManagerState) {
  let state;

  // Convert connection state to ZooKeeper state.
  switch (connectionManagerState) {
    case ConnectionManager.STATES.DISCONNECTED:
      state = State.DISCONNECTED;
      break;
    case ConnectionManager.STATES.CONNECTED:
      state = State.SYNC_CONNECTED;
      break;
    case ConnectionManager.STATES.CONNECTED_READ_ONLY:
      state = State.CONNECTED_READ_ONLY;
      break;
    case ConnectionManager.STATES.SESSION_EXPIRED:
      state = State.EXPIRED;
      break;
    case ConnectionManager.STATES.AUTHENTICATION_FAILED:
      state = State.AUTH_FAILED;
      break;
    default:
      // Not a event in which client is interested, so skip it.
      return;
  }

  if (this.state !== state) {
    this.state = state;
    this.emit('state', this.state);
  }
};

/**
 * Returns the state of the client.
 *
 * @method getState
 * @return {State} the state of the client.
 */
Client.prototype.getState = function() {
  return this.state;
};

/**
 * Returns the session id for this client instance. The value returned is not
 * valid until the client connects to a server and may change after a
 * re-connect.
 *
 * @method getSessionId
 * @return {Buffer} the session id, 8 bytes long buffer.
 */
Client.prototype.getSessionId = function() {
  return this.connectionManager.getSessionId();
};

/**
 * Returns the session password for this client instance. The value returned
 * is not valid until the client connects to a server and may change after a
 * re-connect.
 *
 * @method getSessionPassword
 * @return {Buffer} the session password, 16 bytes buffer.
 */
Client.prototype.getSessionPassword = function() {
  return this.connectionManager.getSessionPassword();
};

/**
 * Returns the negotiated session timeout for this client instance. The value
 * returned is not valid until the client connects to a server and may change
 * after a re-connect.
 *
 * @method getSessionTimeout
 * @return {Integer} the session timeout value.
 */
Client.prototype.getSessionTimeout = function() {
  return this.connectionManager.getSessionTimeout();
};

/**
 * Add the specified scheme:auth information to this client.
 *
 * @method addAuthInfo
 * @param scheme {String} The authentication scheme.
 * @param auth {Buffer} The authentication data buffer.
 */
Client.prototype.addAuthInfo = function(scheme, auth) {
  assert(scheme || typeof scheme === 'string', 'scheme must be a non-empty string.');

  assert(Buffer.isBuffer(auth), 'auth must be a valid instance of Buffer');

  const buffer = new Buffer(auth.length);

  auth.copy(buffer);
  this.connectionManager.addAuthInfo(scheme, buffer);
};

/**
 * Create a node with given path, data, acls and mode.
 *
 * @method create
 * @param path {String} The node path.
 * @param [data=undefined] {Buffer} The data buffer.
 * @param [acls=ACL.OPEN_ACL_UNSAFE] {Array} An array of ACL object.
 * @param [mode=CreateMode.PERSISTENT] {CreateMode} The creation mode.
 * @param callback {Function} The callback function.
 */
Client.prototype.create = function(path, data, acls, mode, callback) {
  const optionalArgs = [data, acls, mode, callback];

  Path.validate(path);

  // Reset arguments so we can reassign correct value to them.
  // eslint-disable-next-line
  data = acls = mode = callback = undefined;
  optionalArgs.forEach(arg => {
    if (Array.isArray(arg)) {
      // eslint-disable-next-line
      acls = arg;
    } else if (typeof arg === 'number') {
      // eslint-disable-next-line
      mode = arg;
    } else if (Buffer.isBuffer(arg)) {
      // eslint-disable-next-line
      data = arg;
    } else if (typeof arg === 'function') {
      // eslint-disable-next-line
      callback = arg;
    }
  });

  assert(typeof callback === 'function', 'callback must be a function.');

  // eslint-disable-next-line
  acls = Array.isArray(acls) ? acls : ACL.OPEN_ACL_UNSAFE;
  // eslint-disable-next-line
  mode = typeof mode === 'number' ? mode : CreateMode.PERSISTENT;

  assert(
    data === null || data === undefined || Buffer.isBuffer(data),
    'data must be a valid buffer, null or undefined.'
  );

  if (Buffer.isBuffer(data)) {
    assert(data.length <= DATA_SIZE_LIMIT, `data must be equal of smaller than ${DATA_SIZE_LIMIT} bytes.`);
  }

  assert(acls.length > 0, 'acls must be a non-empty array.');

  const header = new jute.protocol.RequestHeader();

  header.type = jute.OP_CODES.CREATE;

  const payload = new jute.protocol.CreateRequest();

  payload.path = path;
  payload.acl = acls.map(item => item.toRecord());
  payload.flags = mode;

  if (Buffer.isBuffer(data)) {
    payload.data = new Buffer(data.length);
    data.copy(payload.data);
  }

  const request = new jute.Request(header, payload);

  attempt(
    this,
    (attempts, next) => {
      this.connectionManager.queue(request, (error, response) => {
        if (error) {
          next(error);

          return;
        }

        next(null, response.payload.path);
      });
    },
    callback
  );
};

/**
 * Delete a node with the given path. If version is not -1, the request will
 * fail when the provided version does not match the server version.
 *
 * @method delete
 * @param path {String} The node path.
 * @param [version=-1] {Number} The version of the node.
 * @param callback {Function} The callback function.
 */
Client.prototype.remove = function(path, version, callback) {
  if (!callback) {
    // eslint-disable-next-line
    callback = version;
    // eslint-disable-next-line
    version = -1;
  }

  Path.validate(path);

  assert(typeof callback === 'function', 'callback must be a function.');
  assert(typeof version === 'number', 'version must be a number.');

  const header = new jute.protocol.RequestHeader();
  const payload = new jute.protocol.DeleteRequest();

  header.type = jute.OP_CODES.DELETE;

  payload.path = path;
  payload.version = version;

  const request = new jute.Request(header, payload);

  attempt(
    this,
    (attempts, next) => {
      this.connectionManager.queue(request, error => {
        next(error);
      });
    },
    callback
  );
};

/**
 * Set the data for the node of the given path if such a node exists and the
 * optional given version matches the version of the node (if the given
 * version is -1, it matches any node's versions).
 *
 * @method setData
 * @param path {String} The node path.
 * @param data {Buffer} The data buffer.
 * @param [version=-1] {Number} The version of the node.
 * @param callback {Function} The callback function.
 */
Client.prototype.setData = function(path, data, version, callback) {
  if (!callback) {
    // eslint-disable-next-line
    callback = version;
    // eslint-disable-next-line
    version = -1;
  }

  Path.validate(path);

  assert(typeof callback === 'function', 'callback must be a function.');
  assert(typeof version === 'number', 'version must be a number.');

  assert(
    data === null || data === undefined || Buffer.isBuffer(data),
    'data must be a valid buffer, null or undefined.'
  );
  if (Buffer.isBuffer(data)) {
    assert(data.length <= DATA_SIZE_LIMIT, `data must be equal of smaller than ${DATA_SIZE_LIMIT} bytes.`);
  }

  const header = new jute.protocol.RequestHeader();
  const payload = new jute.protocol.SetDataRequest();

  header.type = jute.OP_CODES.SET_DATA;

  payload.path = path;
  payload.data = new Buffer(data.length);
  data.copy(payload.data);
  payload.version = version;

  const request = new jute.Request(header, payload);

  attempt(
    this,
    (attempts, next) => {
      this.connectionManager.queue(request, (error, response) => {
        if (error) {
          next(error);

          return;
        }

        next(null, response.payload.stat);
      });
    },
    callback
  );
};

/**
 *
 * Retrieve the data and the stat of the node of the given path.
 *
 * If the watcher is provided and the call is successful (no error), a watcher
 * will be left on the node with the given path.
 *
 * The watch will be triggered by a successful operation that sets data on
 * the node, or deletes the node.
 *
 * @method getData
 * @param path {String} The node path.
 * @param [watcher] {Function} The watcher function.
 * @param callback {Function} The callback function.
 */
Client.prototype.getData = function(path, watcher, callback) {
  if (!callback) {
    // eslint-disable-next-line
    callback = watcher;
    // eslint-disable-next-line
    watcher = undefined;
  }

  Path.validate(path);

  assert(typeof callback === 'function', 'callback must be a function.');

  const header = new jute.protocol.RequestHeader();
  const payload = new jute.protocol.GetDataRequest();

  header.type = jute.OP_CODES.GET_DATA;

  payload.path = path;
  payload.watch = typeof watcher === 'function';

  const request = new jute.Request(header, payload);

  attempt(
    this,
    (attempts, next) => {
      this.connectionManager.queue(request, (error, response) => {
        if (error) {
          next(error);

          return;
        }

        if (watcher) {
          this.connectionManager.registerDataWatcher(path, watcher);
        }

        next(null, response.payload.data, response.payload.stat);
      });
    },
    callback
  );
};

/**
 * Set the ACL for the node of the given path if such a node exists and the
 * given version matches the version of the node (if the given version is -1,
 * it matches any node's versions).
 *
 *
 * @method setACL
 * @param path {String} The node path.
 * @param acls {Array} The array of ACL objects.
 * @param [version] {Number} The version of the node.
 * @param callback {Function} The callback function.
 */
Client.prototype.setACL = function(path, acls, version, callback) {
  if (!callback) {
    // eslint-disable-next-line
    callback = version;
    // eslint-disable-next-line
    version = -1;
  }

  Path.validate(path);
  assert(typeof callback === 'function', 'callback must be a function.');
  assert(Array.isArray(acls) && acls.length > 0, 'acls must be a non-empty array.');
  assert(typeof version === 'number', 'version must be a number.');

  const header = new jute.protocol.RequestHeader();
  const payload = new jute.protocol.SetACLRequest();

  header.type = jute.OP_CODES.SET_ACL;

  payload.path = path;
  payload.acl = acls.map(item => item.toRecord());

  payload.version = version;

  const request = new jute.Request(header, payload);

  attempt(
    this,
    (attempts, next) => {
      this.connectionManager.queue(request, (error, response) => {
        if (error) {
          next(error);

          return;
        }

        next(null, response.payload.stat);
      });
    },
    callback
  );
};

/**
 * Retrieve the ACL list and the stat of the node of the given path.
 *
 * @method getACL
 * @param path {String} The node path.
 * @param callback {Function} The callback function.
 */
Client.prototype.getACL = function(path, callback) {
  Path.validate(path);
  assert(typeof callback === 'function', 'callback must be a function.');

  const header = new jute.protocol.RequestHeader();
  const payload = new jute.protocol.GetACLRequest();

  header.type = jute.OP_CODES.GET_ACL;

  payload.path = path;
  const request = new jute.Request(header, payload);

  attempt(
    this,
    (attempts, next) => {
      this.connectionManager.queue(request, (error, response) => {
        if (error) {
          next(error);

          return;
        }

        let acls;

        if (Array.isArray(response.payload.acl)) {
          acls = response.payload.acl.map(item => ACL.fromRecord(item));
        }

        next(null, acls, response.payload.stat);
      });
    },
    callback
  );
};

/**
 * Check the existence of a node. The callback will be invoked with the
 * stat of the given path, or null if node such node exists.
 *
 * If the watcher function is provided and the call is successful (no error
 * from callback), a watcher will be placed on the node with the given path.
 * The watcher will be triggered by a successful operation that creates/delete
 * the node or sets the data on the node.
 *
 * @method exists
 * @param path {String} The node path.
 * @param [watcher] {Function} The watcher function.
 * @param callback {Function} The callback function.
 */
Client.prototype.exists = function(path, watcher, callback) {
  if (!callback) {
    // eslint-disable-next-line
    callback = watcher;
    // eslint-disable-next-line
    watcher = undefined;
  }

  Path.validate(path);
  assert(typeof callback === 'function', 'callback must be a function.');

  const header = new jute.protocol.RequestHeader();
  const payload = new jute.protocol.ExistsRequest();

  header.type = jute.OP_CODES.EXISTS;

  payload.path = path;
  payload.watch = typeof watcher === 'function';

  const request = new jute.Request(header, payload);

  attempt(
    this,
    (attempts, next) => {
      this.connectionManager.queue(request, (error, response) => {
        if (error && error.getCode() !== Exception.NO_NODE) {
          next(error);

          return;
        }

        const existence = response.header.err === Exception.OK;

        if (watcher) {
          if (existence) {
            this.connectionManager.registerDataWatcher(path, watcher);
          } else {
            this.connectionManager.registerExistenceWatcher(path, watcher);
          }
        }

        next(null, existence ? response.payload.stat : null);
      });
    },
    callback
  );
};

/**
 * For the given node path, retrieve the children list and the stat.
 *
 * If the watcher callback is provided and the method completes successfully,
 * a watcher will be placed the given node. The watcher will be triggered
 * when an operation successfully deletes the given node or creates/deletes
 * the child under it.
 *
 * @method getChildren
 * @param path {String} The node path.
 * @param [watcher] {Function} The watcher function.
 * @param callback {Function} The callback function.
 */
Client.prototype.getChildren = function(path, watcher, callback) {
  if (!callback) {
    // eslint-disable-next-line
    callback = watcher;
    // eslint-disable-next-line
    watcher = undefined;
  }

  Path.validate(path);
  assert(typeof callback === 'function', 'callback must be a function.');

  const header = new jute.protocol.RequestHeader();
  const payload = new jute.protocol.GetChildren2Request();

  header.type = jute.OP_CODES.GET_CHILDREN2;

  payload.path = path;
  payload.watch = typeof watcher === 'function';

  const request = new jute.Request(header, payload);

  attempt(
    this,
    (attempts, next) => {
      this.connectionManager.queue(request, (error, response) => {
        if (error) {
          next(error);

          return;
        }

        if (watcher) {
          this.connectionManager.registerChildWatcher(path, watcher);
        }

        next(null, response.payload.children, response.payload.stat);
      });
    },
    callback
  );
};

/**
 * Create node path in the similar way of `mkdir -p`
 *
 *
 * @method mkdirp
 * @param path {String} The node path.
 * @param [data=undefined] {Buffer} The data buffer.
 * @param [acls=ACL.OPEN_ACL_UNSAFE] {Array} The array of ACL object.
 * @param [mode=CreateMode.PERSISTENT] {CreateMode} The creation mode.
 * @param callback {Function} The callback function.
 */
Client.prototype.mkdirp = function(path, data, acls, mode, callback) {
  const optionalArgs = [data, acls, mode, callback];
  let currentPath = '';

  Path.validate(path);

  // Reset arguments so we can reassign correct value to them.
  // eslint-disable-next-line
  data = acls = mode = callback = undefined;
  optionalArgs.forEach(arg => {
    if (Array.isArray(arg)) {
      // eslint-disable-next-line
      acls = arg;
    } else if (typeof arg === 'number') {
      // eslint-disable-next-line
      mode = arg;
    } else if (Buffer.isBuffer(arg)) {
      // eslint-disable-next-line
      data = arg;
    } else if (typeof arg === 'function') {
      // eslint-disable-next-line
      callback = arg;
    }
  });

  assert(typeof callback === 'function', 'callback must be a function.');

  // eslint-disable-next-line
  acls = Array.isArray(acls) ? acls : ACL.OPEN_ACL_UNSAFE;
  // eslint-disable-next-line
  mode = typeof mode === 'number' ? mode : CreateMode.PERSISTENT;

  assert(
    data === null || data === undefined || Buffer.isBuffer(data),
    'data must be a valid buffer, null or undefined.'
  );

  if (Buffer.isBuffer(data)) {
    assert(data.length <= DATA_SIZE_LIMIT, `data must be equal of smaller than ${DATA_SIZE_LIMIT} bytes.`);
  }

  assert(acls.length > 0, 'acls must be a non-empty array.');

  // Remove the empty string
  const nodes = path.split('/').slice(1);

  async.eachSeries(
    nodes,
    (node, next) => {
      currentPath = `${currentPath}/${node}`;
      this.create(currentPath, data, acls, mode, error => {
        // Skip node exist error.
        if (error && error.getCode() === Exception.NODE_EXISTS) {
          next(null);

          return;
        }

        next(error);
      });
    },
    error => {
      callback(error, currentPath);
    }
  );
};

/**
 * Create and return a new Transaction instance.
 *
 * @method transaction
 * @return {Transaction} an instance of Transaction.
 */
Client.prototype.transaction = function() {
  return new Transaction(this.connectionManager);
};

/**
 * Create a new ZooKeeper client.
 *
 * @method createClient
 * @for node-zookeeper-client
 */
function createClient(connectionString, options) {
  return new Client(connectionString, options);
}

exports.createClient = createClient;
exports.ACL = ACL;
exports.Id = Id;
exports.Permission = Permission;
exports.CreateMode = CreateMode;
exports.State = State;
exports.Event = Event;
exports.Exception = Exception;
