import ConnectionStringParser from '../src/ConnectionStringParser';

describe('ConnectionStringParser', () => {
  describe('constructor', () => {
    it('should reject null, undefined and empty string', () => {
      expect(() => new ConnectionStringParser()).toThrow('non-empty string');
      expect(() => new ConnectionStringParser(null)).toThrow('non-empty string');
      expect(() => new ConnectionStringParser('')).toThrow('non-empty string');
    });

    it('should reject invalid chroot path', () => {
      expect(() => new ConnectionStringParser('localhost:2181/../test/')).toThrow('path');
    });

    it('should reject empty server list.', () => {
      expect(() => new ConnectionStringParser('/test')).toThrow('at least one');
    });
  });

  describe('getConnectionString', () => {
    it('should return the same string passed to constructor', () => {
      const s = 'localhost:2181';
      const parser = new ConnectionStringParser(s);

      expect(parser.getConnectionString()).toEqual(s);
    });
  });

  describe('getChrootPath', () => {
    it('should return non-empty chroot', () => {
      const parser = new ConnectionStringParser('localhost:2181/test');

      expect(parser.getChrootPath()).toEqual('/test');
    });

    it('should return undefined for empty chroot', () => {
      const parser = new ConnectionStringParser('localhost:2181');

      expect(parser.getChrootPath()).toBeUndefined();
    });

    it('should work for multiple servers', () => {
      const parser = new ConnectionStringParser('localhost:2181,localhost:2182/test');

      expect(parser.getChrootPath()).toEqual('/test');
    });
  });

  describe('getServers', () => {
    it('should return an array of host:port objects', () => {
      const s = 'localhost:2181,localhost:2182';
      const parser = new ConnectionStringParser(s);
      const servers = parser.getServers();

      expect(servers).toBeInstanceOf(Array);
      expect(servers).toHaveLength(2);
      expect(servers).toMatchObject([
        {
          host: 'localhost',
          port: expect.stringMatching(/218(1|2)/),
        },
        {
          host: 'localhost',
          port: expect.stringMatching(/218(1|2)/),
        },
      ]);
    });

    it('should add default port if port is not provided', () => {
      const s = 'localhost';
      const parser = new ConnectionStringParser(s);
      const servers = parser.getServers();

      expect(servers).toBeInstanceOf(Array);
      expect(servers).toHaveLength(1);
      expect(servers).toMatchObject([
        {
          host: 'localhost',
          port: 2181,
        },
      ]);
    });
  });
});
