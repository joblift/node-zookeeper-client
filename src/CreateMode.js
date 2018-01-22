const CREATE_MODES = {
  /**
   * The znode will not be automatically deleted upon client's disconnect.
   */
  PERSISTENT: 0,

  /**
   * The znode will not be automatically deleted upon client's disconnect,
   * and its name will be appended with a monotonically increasing number.
   */
  PERSISTENT_SEQUENTIAL: 2,

  /**
   * The znode will be deleted upon the client's disconnect.
   */
  EPHEMERAL: 1,

  /**
   * The znode will be deleted upon the client's disconnect, and its name
   * will be appended with a monotonically increasing number.
   */
  EPHEMERAL_SEQUENTIAL: 3,
};

module.exports = CREATE_MODES;
