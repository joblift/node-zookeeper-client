import Event from '../src/Event';

describe('Event', () => {
  describe('create', () => {
    it('should only accept instance of WatcherEvent', () => {
      expect(() => {
        Event.create();
      }).toThrow('object');
    });

    it('should reject invalid type of WatcherEvent', () => {
      expect(() => {
        Event.create({
          type: 111,
        });
      }).toThrow('type');
    });

    it('should return an instance of Event', () => {
      const e = Event.create({
        type: Event.NODE_CREATED,
      });

      expect(e).toBeInstanceOf(Event);
    });
  });

  describe('getType', () => {
    it('should return the given type.', () => {
      const e = Event.create({
        type: Event.NODE_DATA_CHANGED,
      });

      expect(e.getType()).toEqual(Event.NODE_DATA_CHANGED);
    });
  });

  describe('getName', () => {
    it('should return the correct name.', () => {
      const e = Event.create({
        type: Event.NODE_DELETED,
      });

      expect(e.getName()).toEqual('NODE_DELETED');
    });
  });

  describe('getPath', () => {
    it('should return the correct path.', () => {
      const e = Event.create({
        type: Event.NODE_CREATED,
        path: '/test',
      });

      expect(e.getPath()).toEqual('/test');
    });
  });

  describe('toString', () => {
    it('should return the correctly formatted string with a path.', () => {
      const e = Event.create({
        type: Event.NODE_CREATED,
        path: '/test',
      });

      expect(e.toString()).toEqual(`NODE_CREATED[${Event.NODE_CREATED}]@/test`);
    });

    it('should return the correctly formatted string without a path.', () => {
      const e = Event.create({
        type: Event.NODE_CREATED,
      });

      expect(e.toString()).toEqual(`NODE_CREATED[${Event.NODE_CREATED}]`);
    });
  });
});
