import Path from '../src/Path';

describe('Path', () => {
  describe('validate', () => {
    it('should reject null, undefined and empty string', () => {
      expect(() => {
        Path.validate();
      }).toThrow('non-empty string');
      expect(() => {
        Path.validate(null);
      }).toThrow('non-empty string');
      expect(() => {
        Path.validate('');
      }).toThrow('non-empty string');
    });

    it('should reject path does not start with /.', () => {
      expect(() => {
        Path.validate('abc');
      }).toThrow('start with /');
    });

    it('should reject path ends with /.', () => {
      expect(() => {
        Path.validate('/abc/');
      }).toThrow('end with /');
    });

    it('should reject path contains empty node.', () => {
      expect(() => {
        Path.validate('//a');
      }).toThrow('empty');
    });

    it('should reject relative path.', () => {
      expect(() => {
        Path.validate('/.');
      }).toThrow('relative path');

      expect(() => {
        Path.validate('/./a');
      }).toThrow('relative path');

      expect(() => {
        Path.validate('/..');
      }).toThrow('relative path');

      expect(() => {
        Path.validate('/../a');
      }).toThrow('relative path');
    });

    it('should accept dot in the the path name', () => {
      expect(() => {
        Path.validate('/a.b');
      }).not.toThrow('relative path');

      expect(() => {
        Path.validate('/a..b');
      }).not.toThrow('relative path');
    });

    it('should accept root path', () => {
      expect(() => {
        Path.validate('/');
      }).not.toThrow('relative path');
    });
  });
});
