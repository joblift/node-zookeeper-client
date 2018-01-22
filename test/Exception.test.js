import Exception from '../src/Exception';

describe('Exception', () => {
  it('does not require path', () => {
    const exception = new Exception(0, 'name', () => {});

    expect(exception.path).toBeUndefined();
  });

  it('requires ctor to be a function', () => {
    expect(() => new Exception(0, 'name', null)).toThrow('ctor must be a function.');
  });

  describe('create', () => {
    it('should only accept number code', () => {
      expect(() => {
        Exception.create('zzz');
      }).toThrow('must be a number');
      expect(() => {
        Exception.create();
      }).toThrow('must be a number');
      expect(() => {
        Exception.create(null);
      }).toThrow('must be a number');
    });

    it('should only accept predefined code', () => {
      expect(() => {
        Exception.create(111111);
      }).toThrow('Unknown code');
      expect(() => {
        Exception.create(-111111);
      }).toThrow('Unknown code');
    });

    it('should return an instance of Error', () => {
      const e = Exception.create(Exception.OK);

      expect(e).toBeInstanceOf(Error);
    });

    it('should return an instance of Exception', () => {
      const e = Exception.create(Exception.OK);

      expect(e).toBeInstanceOf(Exception);
    });
  });

  describe('getCode', () => {
    it('should return the given code.', () => {
      const e = Exception.create(Exception.SYSTEM_ERROR);

      expect(e.getCode()).toEqual(Exception.SYSTEM_ERROR);
    });
  });

  describe('getName', () => {
    it('should return the correct name.', () => {
      const e = Exception.create(Exception.SYSTEM_ERROR);

      expect(e.getName()).toEqual('SYSTEM_ERROR');
    });
  });

  describe('getPath', () => {
    it('should return the correct path.', () => {
      const e = Exception.create(Exception.SYSTEM_ERROR, '/test');

      expect(e.getPath()).toEqual('/test');
    });
  });

  describe('toString', () => {
    it('should return the correctly formatted string.', () => {
      const e1 = Exception.create(Exception.NO_NODE, '/test');
      const e2 = Exception.create(Exception.NO_NODE);

      expect(e1.toString()).toEqual(`Exception: NO_NODE[${Exception.NO_NODE}]@/test`);
      expect(e2.toString()).toEqual(`Exception: NO_NODE[${Exception.NO_NODE}]`);
    });
  });
});
