/* eslint callback-return: 0 */
import ConnectionStringParser from './ConnectionStringParser';
import events from 'events';
import Exception from './Exception';
import jute from './jute';
import net from 'net';
import PacketQueue from './PacketQueue';
import utils from 'util';
import WatcherManager from './WatcherManager';

/**
 * This class manages the connection between the client and the ensemble.
 *
 */

// Constants.
const STATES = {
  // Connection States.
  DISCONNECTED: 0,
  CONNECTING: 1,
  CONNECTED: 2,
  CONNECTED_READ_ONLY: 3,
  CLOSING: -1,
  CLOSED: -2,
  SESSION_EXPIRED: -3,
  AUTHENTICATION_FAILED: -4,
};

/**
 * Construct a new ConnectionManager instance.
 *
 * @class ConnectionStringParser
 * @constructor
 * @param connectionString {String} ZooKeeper server ensemble string.
 * @param options {Object} Client options.
 * @param stateListener {Object} Listener for state changes.
 */
function ConnectionManager(connectionString, options, stateListener) {
  events.EventEmitter.call(this);

  this.watcherManager = new WatcherManager();
  this.connectionStringParser = new ConnectionStringParser(connectionString);

  this.servers = this.connectionStringParser.getServers();
  this.chrootPath = this.connectionStringParser.getChrootPath();
  this.nextServerIndex = 0;
  this.serverAttempts = 0;

  this.state = STATES.DISCONNECTED;

  this.options = options;
  this.spinDelay = options.spinDelay;

  this.updateTimeout(options.sessionTimeout);
  this.connectTimeoutHandler = null;

  this.xid = 0;

  this.sessionId = new Buffer(8);
  if (Buffer.isBuffer(options.sessionId)) {
    options.sessionId.copy(this.sessionId);
  } else {
    this.sessionId.fill(0);
  }

  this.sessionPassword = new Buffer(16);
  if (Buffer.isBuffer(options.sessionPassword)) {
    options.sessionPassword.copy(this.sessionPassword);
  } else {
    this.sessionPassword.fill(0);
  }

  // scheme:auth pairs
  this.credentials = [];

  // Last seen zxid.
  this.zxid = new Buffer(8);
  this.zxid.fill(0);

  this.pendingBuffer = null;

  this.packetQueue = new PacketQueue();
  this.packetQueue.on('readable', this.onPacketQueueReadable.bind(this));
  this.pendingQueue = [];

  this.on('state', stateListener);
}

utils.inherits(ConnectionManager, events.EventEmitter);

/**
 * Update the session timeout and related timeout variables.
 *
 * @method updateTimeout
 * @private
 * @param sessionTimeout {Number} Milliseconds of the timeout value.
 */
ConnectionManager.prototype.updateTimeout = function(sessionTimeout) {
  this.sessionTimeout = sessionTimeout;

  // Designed to have time to try all the servers.
  this.connectTimeout = Math.floor(sessionTimeout / this.servers.length);

  // We at least send out one ping one third of the session timeout, so
  // the read timeout is two third of the session timeout.
  this.pingTimeout = Math.floor(this.sessionTimeout / 3);
  // this.readTimeout = Math.floor(sessionTimeout * 2 / 3);
};

/**
 * Find the next available server to connect. If all server has been tried,
 * it will wait for a random time between 0 to spin delay before call back
 * with the next server.
 *
 * callback prototype:
 * callback(server);
 *
 * @method findNextServer
 * @param callback {Function} callback function.
 *
 */
ConnectionManager.prototype.findNextServer = function(callback) {
  this.nextServerIndex %= this.servers.length;

  if (this.serverAttempts === this.servers.length) {
    setTimeout(() => {
      callback(this.servers[this.nextServerIndex]);
      this.nextServerIndex += 1;

      // reset attempts since we already waited for enough time.
      this.serverAttempts = 0;
    }, Math.random() * this.spinDelay);
  } else {
    this.serverAttempts += 1;

    process.nextTick(() => {
      callback(this.servers[this.nextServerIndex]);
      this.nextServerIndex += 1;
    });
  }
};

/**
 * Change the current state to the given state if the given state is different
 * from current state. Emit the state change event with the changed state.
 *
 * @method setState
 * @param state {Number} The state to be set.
 */
ConnectionManager.prototype.setState = function(state) {
  if (typeof state !== 'number') {
    throw new Error('state must be a valid number.');
  }

  if (this.state !== state) {
    this.state = state;
    this.emit('state', this.state);
  }
};

ConnectionManager.prototype.registerDataWatcher = function(path, watcher) {
  this.watcherManager.registerDataWatcher(path, watcher);
};

ConnectionManager.prototype.registerChildWatcher = function(path, watcher) {
  this.watcherManager.registerChildWatcher(path, watcher);
};

ConnectionManager.prototype.registerExistenceWatcher = function(path, watcher) {
  this.watcherManager.registerExistenceWatcher(path, watcher);
};

ConnectionManager.prototype.cleanupPendingQueue = function(errorCode) {
  let pendingPacket = this.pendingQueue.shift();

  while (pendingPacket) {
    if (pendingPacket.callback) {
      pendingPacket.callback(Exception.create(errorCode));
    }

    pendingPacket = this.pendingQueue.shift();
  }
};

ConnectionManager.prototype.getSessionId = function() {
  const result = new Buffer(8);

  this.sessionId.copy(result);

  return result;
};

ConnectionManager.prototype.getSessionPassword = function() {
  const result = new Buffer(16);

  this.sessionPassword.copy(result);

  return result;
};

ConnectionManager.prototype.getSessionTimeout = function() {
  return this.sessionTimeout;
};

ConnectionManager.prototype.connect = function() {
  this.setState(STATES.CONNECTING);

  this.findNextServer(server => {
    this.socket = net.connect(server);

    this.connectTimeoutHandler = setTimeout(this.onSocketConnectTimeout.bind(this), this.connectTimeout);

    // Disable the Nagle algorithm.
    this.socket.setNoDelay();

    this.socket.on('connect', this.onSocketConnected.bind(this));
    this.socket.on('data', this.onSocketData.bind(this));
    this.socket.on('drain', this.onSocketDrain.bind(this));
    this.socket.on('close', this.onSocketClosed.bind(this));
    this.socket.on('error', this.onSocketError.bind(this));
  });
};

ConnectionManager.prototype.close = function() {
  const header = new jute.protocol.RequestHeader();

  this.setState(STATES.CLOSING);
  header.type = jute.OP_CODES.CLOSE_SESSION;
  const request = new jute.Request(header, null);

  this.queue(request);
};

ConnectionManager.prototype.onSocketClosed = function() {
  let errorCode;
  let retry = false;

  switch (this.state) {
    case STATES.CLOSING:
      errorCode = Exception.CONNECTION_LOSS;
      retry = false;
      break;
    case STATES.SESSION_EXPIRED:
      errorCode = Exception.SESSION_EXPIRED;
      retry = false;
      break;
    case STATES.AUTHENTICATION_FAILED:
      errorCode = Exception.AUTH_FAILED;
      retry = false;
      break;
    default:
      errorCode = Exception.CONNECTION_LOSS;
      retry = true;
  }

  this.cleanupPendingQueue(errorCode);
  this.setState(STATES.DISCONNECTED);

  if (retry) {
    this.connect();
  } else {
    this.setState(STATES.CLOSED);
  }
};

ConnectionManager.prototype.onSocketError = function() {
  if (this.connectTimeoutHandler) {
    clearTimeout(this.connectTimeoutHandler);
  }

  // After socket error, the socket closed event will be triggered,
  // we will retry connect in that listener function.
};

ConnectionManager.prototype.onSocketConnectTimeout = function() {
  // Destroy the current socket so the socket closed event
  // will be trigger.
  this.socket.destroy();
};

ConnectionManager.prototype.onSocketConnected = function() {
  let authRequest;
  let header;
  let payload;
  let setWatchesRequest;

  const connectRequest = new jute.Request(
    null,
    new jute.protocol.ConnectRequest(
      jute.PROTOCOL_VERSION,
      this.zxid,
      this.sessionTimeout,
      this.sessionId,
      this.sessionPassword
    )
  );

  // XXX No read only support yet.
  this.socket.write(connectRequest.toBuffer());

  // Set auth info
  if (this.credentials.length > 0) {
    this.credentials.forEach(function(credential) {
      header = new jute.protocol.RequestHeader();
      payload = new jute.protocol.AuthPacket();

      header.xid = jute.XID_AUTHENTICATION;
      header.type = jute.OP_CODES.AUTH;

      payload.type = 0;
      payload.scheme = credential.scheme;
      payload.auth = credential.auth;

      authRequest = new jute.Request(header, payload);
      this.queue(authRequest);
    }, this);
  }

  // Reset the watchers if we have any.
  if (!this.watcherManager.isEmpty()) {
    header = new jute.protocol.RequestHeader();
    payload = new jute.protocol.SetWatches();

    header.type = jute.OP_CODES.SET_WATCHES;
    header.xid = jute.XID_SET_WATCHES;

    payload.setChrootPath(this.chrootPath);
    payload.relativeZxid = this.zxid;
    payload.dataWatches = this.watcherManager.getDataWatcherPaths();
    payload.existWatches = this.watcherManager.getExistenceWatcherPaths();
    payload.childWatches = this.watcherManager.getChildWatcherPaths();

    setWatchesRequest = new jute.Request(header, payload);
    this.queue(setWatchesRequest);
  }
};

ConnectionManager.prototype.onSocketTimeout = function() {
  let header;
  let request;

  if (this.socket && (this.state === STATES.CONNECTED || this.state === STATES.CONNECTED_READ_ONLY)) {
    // If the server hasn't talked to us lately, initiate a reconnect
    if (Date.now() > this.lastHeard + this.sessionTimeout) {
      this.socket.destroy();

      return;
    }
    header = new jute.protocol.RequestHeader(jute.XID_PING, jute.OP_CODES.PING);

    request = new jute.Request(header, null);
    this.queue(request);

    // Re-register the timeout handler since it only fired once.
    this.socket.setTimeout(this.pingTimeout, this.onSocketTimeout.bind(this));
  }
};

/* eslint-disable complexity,max-depth */
ConnectionManager.prototype.onSocketData = function(buffer) {
  let offset = 0;
  let size = 0;
  let connectResponse;
  let pendingPacket;
  let responseHeader;
  let responsePayload;
  let event;

  // Combine the pending buffer with the new buffer.
  if (this.pendingBuffer) {
    // eslint-disable-next-line
    buffer = Buffer.concat([this.pendingBuffer, buffer], this.pendingBuffer.length + buffer.length);
  }

  // We need at least 4 bytes
  if (buffer.length < 4) {
    this.pendingBuffer = buffer;

    return;
  }

  size = buffer.readInt32BE(offset);
  offset += 4;

  if (buffer.length < size + 4) {
    // More data are coming.
    this.pendingBuffer = buffer;

    return;
  }

  if (buffer.length === size + 4) {
    // The size is perfect.
    this.pendingBuffer = null;
  } else {
    // We have extra bytes, splice them out as pending buffer.
    this.pendingBuffer = buffer.slice(size + 4);
    // eslint-disable-next-line
    buffer = buffer.slice(0, size + 4);
  }

  this.lastHeard = Date.now();
  if (this.state === STATES.CONNECTING) {
    // Handle connect response.
    connectResponse = new jute.protocol.ConnectResponse();
    offset += connectResponse.deserialize(buffer, offset);

    if (this.connectTimeoutHandler) {
      clearTimeout(this.connectTimeoutHandler);
    }

    if (connectResponse.timeOut <= 0) {
      this.setState(STATES.SESSION_EXPIRED);
    } else {
      // Reset the server connection attempts since we connected now.
      this.serverAttempts = 0;

      this.sessionId = connectResponse.sessionId;
      this.sessionPassword = connectResponse.passwd;
      this.updateTimeout(connectResponse.timeOut);

      this.setState(STATES.CONNECTED);

      // Check if we have anything to send out just in case.
      this.onPacketQueueReadable();

      this.socket.setTimeout(this.pingTimeout, this.onSocketTimeout.bind(this));
    }
  } else {
    // Handle  all other repsonses.
    responseHeader = new jute.protocol.ReplyHeader();
    offset += responseHeader.deserialize(buffer, offset);

    // TODO BETTTER LOGGING
    switch (responseHeader.xid) {
      case jute.XID_PING:
        break;
      case jute.XID_AUTHENTICATION:
        if (responseHeader.err === Exception.AUTH_FAILED) {
          this.setState(STATES.AUTHENTICATION_FAILED);
        }
        break;
      case jute.XID_NOTIFICATION:
        event = new jute.protocol.WatcherEvent();

        if (this.chrootPath) {
          event.setChrootPath(this.chrootPath);
        }

        offset += event.deserialize(buffer, offset);
        this.watcherManager.emit(event);
        break;
      default:
        pendingPacket = this.pendingQueue.shift();

        if (!pendingPacket) {
          // TODO, better error handling and logging need to be done.
          // Need to clean up and do a reconnect.
          // throw new Error(
          //    'Nothing in pending queue but got data from server.'
          // );
          this.socket.destroy(); // this will trigger reconnect

          return;
        }

        if (pendingPacket.request.header.xid !== responseHeader.xid) {
          // TODO, better error handling/logging need to bee done here.
          // Need to clean up and do a reconnect.
          // throw new Error(
          // 'Xid out of order. Got xid: ' +
          // responseHeader.xid + ' with error code: ' +
          // responseHeader.err + ', expected xid: ' +
          // pendingPacket.request.header.xid + '.'
          // );
          this.socket.destroy(); // this will trigger reconnect

          return;
        }

        if (responseHeader.zxid) {
          // TODO, In Java implementation, the condition is to
          // check whether the long zxid is greater than 0, here
          // use buffer so we simplify.
          // Need to figure out side effect.
          this.zxid = responseHeader.zxid;
        }

        if (responseHeader.err === 0) {
          switch (pendingPacket.request.header.type) {
            case jute.OP_CODES.CREATE:
              responsePayload = new jute.protocol.CreateResponse();
              break;
            case jute.OP_CODES.DELETE:
              responsePayload = null;
              break;
            case jute.OP_CODES.GET_CHILDREN2:
              responsePayload = new jute.protocol.GetChildren2Response();
              break;
            case jute.OP_CODES.EXISTS:
              responsePayload = new jute.protocol.ExistsResponse();
              break;
            case jute.OP_CODES.SET_DATA:
              responsePayload = new jute.protocol.SetDataResponse();
              break;
            case jute.OP_CODES.GET_DATA:
              responsePayload = new jute.protocol.GetDataResponse();
              break;
            case jute.OP_CODES.SET_ACL:
              responsePayload = new jute.protocol.SetACLResponse();
              break;
            case jute.OP_CODES.GET_ACL:
              responsePayload = new jute.protocol.GetACLResponse();
              break;
            case jute.OP_CODES.SET_WATCHES:
              responsePayload = null;
              break;
            case jute.OP_CODES.CLOSE_SESSION:
              responsePayload = null;
              break;
            case jute.OP_CODES.MULTI:
              responsePayload = new jute.TransactionResponse();
              break;
            default:
              // throw new Error('Unknown request OP_CODE: ' +
              // pendingPacket.request.header.type);
              this.socket.destroy(); // this will trigger reconnect

              return;
          }

          if (responsePayload) {
            if (this.chrootPath) {
              responsePayload.setChrootPath(this.chrootPath);
            }

            offset += responsePayload.deserialize(buffer, offset);
          }

          if (pendingPacket.callback) {
            pendingPacket.callback(null, new jute.Response(responseHeader, responsePayload));
          }
        } else if (pendingPacket.callback) {
          pendingPacket.callback(Exception.create(responseHeader.err), new jute.Response(responseHeader, null));
        }
    }
  }

  // We have more data to process, need to recursively process it.
  if (this.pendingBuffer) {
    this.onSocketData(new Buffer(0));
  }
};

/* eslint-enable complexity,max-depth */

ConnectionManager.prototype.onSocketDrain = function() {
  // Trigger write on socket.
  this.onPacketQueueReadable();
};

ConnectionManager.prototype.onPacketQueueReadable = function() {
  let header;
  let packet;

  switch (this.state) {
    case STATES.CONNECTED:
    case STATES.CONNECTED_READ_ONLY:
    case STATES.CLOSING:
      // Continue
      break;
    case STATES.DISCONNECTED:
    case STATES.CONNECTING:
    case STATES.CLOSED:
    case STATES.SESSION_EXPIRED:
    case STATES.AUTHENTICATION_FAILED:
      // Skip since we can not send traffic out
      return;
    default:
      throw new Error(`Unknown state: ${this.state}`);
  }

  while ((packet = this.packetQueue.shift()) !== undefined) {
    header = packet.request.header;
    if (header !== null && header.type !== jute.OP_CODES.PING && header.type !== jute.OP_CODES.AUTH) {
      header.xid = this.xid;
      this.xid += 1;

      // Only put requests that are not connect, ping and auth into
      // the pending queue.
      this.pendingQueue.push(packet);
    }

    if (!this.socket.write(packet.request.toBuffer())) {
      // Back pressure is handled here, when the socket emit
      // drain event, this method will be invoked again.
      break;
    }

    if (header.type === jute.OP_CODES.CLOSE_SESSION) {
      // The close session should be the final packet sent to the
      // server.
      break;
    }
  }
};

ConnectionManager.prototype.addAuthInfo = function(scheme, auth) {
  if (!scheme || typeof scheme !== 'string') {
    throw new Error('scheme must be a non-empty string.');
  }

  if (!Buffer.isBuffer(auth)) {
    throw new Error('auth must be a valid instance of Buffer');
  }

  let header;
  let payload;

  this.credentials.push({
    scheme,
    auth,
  });

  switch (this.state) {
    case STATES.CONNECTED:
    case STATES.CONNECTED_READ_ONLY:
      // Only queue the auth request when connected.
      header = new jute.protocol.RequestHeader();
      payload = new jute.protocol.AuthPacket();

      header.xid = jute.XID_AUTHENTICATION;
      header.type = jute.OP_CODES.AUTH;

      payload.type = 0;
      payload.scheme = scheme;
      payload.auth = auth;

      this.queue(new jute.Request(header, payload));
      break;
    case STATES.DISCONNECTED:
    case STATES.CONNECTING:
    case STATES.CLOSING:
    case STATES.CLOSED:
    case STATES.SESSION_EXPIRED:
    case STATES.AUTHENTICATION_FAILED:
      // Skip when we are not in a live state.
      return;
    default:
      throw new Error(`Unknown state: ${this.state}`);
  }
};

ConnectionManager.prototype.queue = function(request, callback = () => {}) {
  if (typeof request !== 'object') {
    throw new Error('request must be a valid instance of jute.Request.');
  }

  if (this.chrootPath && request.payload) {
    request.payload.setChrootPath(this.chrootPath);
  }

  switch (this.state) {
    case STATES.DISCONNECTED:
    case STATES.CONNECTING:
    case STATES.CONNECTED:
    case STATES.CONNECTED_READ_ONLY:
      // queue the packet
      this.packetQueue.push({
        request,
        callback,
      });
      break;
    case STATES.CLOSING:
      if (request.header && request.header.type === jute.OP_CODES.CLOSE_SESSION) {
        this.packetQueue.push({
          request,
          callback,
        });
      } else {
        callback(Exception.create(Exception.CONNECTION_LOSS));
      }
      break;
    case STATES.CLOSED:
      callback(Exception.create(Exception.CONNECTION_LOSS));

      return;
    case STATES.SESSION_EXPIRED:
      callback(Exception.create(Exception.SESSION_EXPIRED));

      return;
    case STATES.AUTHENTICATION_FAILED:
      callback(Exception.create(Exception.AUTH_FAILED));

      return;
    default:
      throw new Error(`Unknown state: ${this.state}`);
  }
};

module.exports = ConnectionManager;
module.exports.STATES = STATES;
