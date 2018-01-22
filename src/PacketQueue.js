/**
 * The package queue which emits events.
 */

import events from 'events';
import util from 'util';

function PacketQueue() {
  events.EventEmitter.call(this);

  this.queue = [];
}

util.inherits(PacketQueue, events.EventEmitter);

PacketQueue.prototype.push = function(packet) {
  if (typeof packet !== 'object') {
    throw new Error('packet must be a valid object.');
  }

  this.queue.push(packet);

  this.emit('readable');
};

PacketQueue.prototype.unshift = function(packet) {
  if (typeof packet !== 'object') {
    throw new Error('packet must be a valid object.');
  }

  this.queue.unshift(packet);
  this.emit('readable');
};

PacketQueue.prototype.shift = function() {
  return this.queue.shift();
};

module.exports = PacketQueue;
