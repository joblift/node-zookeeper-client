import Event from '../src/Event';
import WatcherManager from '../src/WatcherManager';

describe('WatcherManager', () => {
  describe('registerWatcher', () => {
    it('should not register same watcher more than once for same event and path.', () => {
      const wm = new WatcherManager();
      let count = 0;
      const watcher = () => (count += 1);

      wm.registerDataWatcher('/test', watcher);
      wm.registerDataWatcher('/test', watcher);

      wm.emit({
        type: Event.NODE_DELETED,
        path: '/test',
      });

      expect(count).toEqual(1);
    });

    it('can register same watcher for different events for the same path.', () => {
      const wm = new WatcherManager();
      let count = 0;
      const watcher = () => (count += 1);

      wm.registerDataWatcher('/test', watcher);
      wm.registerChildWatcher('/test', watcher);

      wm.emit({
        type: Event.NODE_DELETED,
        path: '/test',
      });

      wm.emit({
        type: Event.NODE_CHILDREN_CHANGED,
        path: '/test',
      });

      expect(count).toEqual(2);
    });

    it('throws if registering something other then a function', () => {
      const wm = new WatcherManager();

      expect(() => {
        wm.registerDataWatcher('/test', {});
      }).toThrow(Error, 'watcher must be a valid function.');
    });
  });

  describe('isEmpty', () => {
    it('is empty if there are no watchers.', () => {
      const wm = new WatcherManager();

      expect(wm.isEmpty()).toBeTruthy();
    });

    it('is not empty if there is a data watcher.', () => {
      const wm = new WatcherManager();

      wm.registerDataWatcher('/test', () => {});
      expect(wm.isEmpty()).toBeFalsy();
    });

    it('is not empty if there is a child watcher.', () => {
      const wm = new WatcherManager();

      wm.registerChildWatcher('/test', () => {});
      expect(wm.isEmpty()).toBeFalsy();
    });

    it('is not empty if there is an existence watcher.', () => {
      const wm = new WatcherManager();

      wm.registerExistenceWatcher('/test', () => {});
      expect(wm.isEmpty()).toBeFalsy();
    });
  });

  describe('getDataWatcherPaths', () => {
    it('is empty if there are no data watchers.', () => {
      const wm = new WatcherManager();

      wm.registerExistenceWatcher('/existence', () => {});
      wm.registerChildWatcher('/child', () => {});

      expect(wm.getDataWatcherPaths()).toEqual([]);
    });

    it('only returns paths of data watchers.', () => {
      const wm = new WatcherManager();

      wm.registerDataWatcher('/data', () => {});
      wm.registerExistenceWatcher('/existence', () => {});
      wm.registerChildWatcher('/child', () => {});
      expect(wm.getDataWatcherPaths()).toEqual(['/data']);
    });

    it('does not duplicate paths.', () => {
      const wm = new WatcherManager();

      wm.registerDataWatcher('/data', () => {});
      wm.registerDataWatcher('/data', () => {});
      expect(wm.getDataWatcherPaths()).toEqual(['/data']);
    });
  });

  describe('getExistenceWatcherPaths', () => {
    it('is empty if there are no existence watchers.', () => {
      const wm = new WatcherManager();

      wm.registerDataWatcher('/data', () => {});
      wm.registerChildWatcher('/child', () => {});

      expect(wm.getExistenceWatcherPaths()).toEqual([]);
    });

    it('only returns paths of existence watchers.', () => {
      const wm = new WatcherManager();

      wm.registerDataWatcher('/data', () => {});
      wm.registerExistenceWatcher('/existence', () => {});
      wm.registerChildWatcher('/child', () => {});
      expect(wm.getExistenceWatcherPaths()).toEqual(['/existence']);
    });

    it('does not duplicate paths.', () => {
      const wm = new WatcherManager();

      wm.registerExistenceWatcher('/existence', () => {});
      wm.registerExistenceWatcher('/existence', () => {});
      expect(wm.getExistenceWatcherPaths()).toEqual(['/existence']);
    });
  });

  describe('getChildWatcherPaths', () => {
    it('is empty if there are no existence watchers.', () => {
      const wm = new WatcherManager();

      wm.registerDataWatcher('/data', () => {});
      wm.registerExistenceWatcher('/existence', () => {});

      expect(wm.getChildWatcherPaths()).toEqual([]);
    });

    it('only returns paths of child watchers.', () => {
      const wm = new WatcherManager();

      wm.registerDataWatcher('/data', () => {});
      wm.registerExistenceWatcher('/existence', () => {});
      wm.registerChildWatcher('/child', () => {});
      expect(wm.getChildWatcherPaths()).toEqual(['/child']);
    });

    it('does not duplicate paths.', () => {
      const wm = new WatcherManager();

      wm.registerChildWatcher('/child', () => {});
      wm.registerChildWatcher('/child', () => {});
      expect(wm.getChildWatcherPaths()).toEqual(['/child']);
    });
  });

  describe('emit', () => {
    it('only emits valid objects.', () => {
      const wm = new WatcherManager();

      expect(() => {
        wm.emit(null);
      }).toThrow(Error, 'watcherEvent must be a valid object.');
    });

    it('only emits known event types.', () => {
      const wm = new WatcherManager();
      const fakeEvent = {
        type: 'fake event',
      };

      expect(() => {
        wm.emit({
          type: 'fake event',
        });
      }).toThrow(Error, `Unknown event type: ${fakeEvent.type}`);
    });

    describe('NODE_CREATED events', () => {
      it('notifies data watchers.', () => {
        const wm = new WatcherManager();
        let count = 0;

        wm.registerDataWatcher('/test', () => {
          count += 1;
        });
        wm.emit({
          type: Event.NODE_CREATED,
          path: '/test',
        });

        expect(count).toEqual(1);
      });

      it('notifies existence watchers.', () => {
        const wm = new WatcherManager();
        let count = 0;

        wm.registerExistenceWatcher('/test', () => {
          count += 1;
        });
        wm.emit({
          type: Event.NODE_CREATED,
          path: '/test',
        });

        expect(count).toEqual(1);
      });

      it('does not notify child watchers.', () => {
        const wm = new WatcherManager();
        let count = 0;

        wm.registerChildWatcher('/test', () => {
          count += 1;
        });
        wm.emit({
          type: Event.NODE_CREATED,
          path: '/test',
        });

        expect(count).toEqual(0);
      });
    });

    describe('NODE_DATA_CHANGED events', () => {
      it('notifies data watchers.', () => {
        const wm = new WatcherManager();
        let count = 0;

        wm.registerDataWatcher('/test', () => {
          count += 1;
        });
        wm.emit({
          type: Event.NODE_DATA_CHANGED,
          path: '/test',
        });

        expect(count).toEqual(1);
      });

      it('notifies existence watchers.', () => {
        const wm = new WatcherManager();
        let count = 0;

        wm.registerExistenceWatcher('/test', () => {
          count += 1;
        });
        wm.emit({
          type: Event.NODE_DATA_CHANGED,
          path: '/test',
        });

        expect(count).toEqual(1);
      });

      it('does not notify child watchers.', () => {
        const wm = new WatcherManager();
        let count = 0;

        wm.registerChildWatcher('/test', () => {
          count += 1;
        });
        wm.emit({
          type: Event.NODE_DATA_CHANGED,
          path: '/test',
        });

        expect(count).toEqual(0);
      });
    });

    describe('NODE_CHILDREN_CHANGED events', () => {
      it('notifies child watchers.', () => {
        const wm = new WatcherManager();
        let count = 0;

        wm.registerChildWatcher('/test', () => {
          count += 1;
        });
        wm.emit({
          type: Event.NODE_CHILDREN_CHANGED,
          path: '/test',
        });

        expect(count).toEqual(1);
      });

      it('does not notify data watchers.', () => {
        const wm = new WatcherManager();
        let count = 0;

        wm.registerDataWatcher('/test', () => {
          count += 1;
        });
        wm.emit({
          type: Event.NODE_CHILDREN_CHANGED,
          path: '/test',
        });

        expect(count).toEqual(0);
      });

      it('does not notify existence watchers.', () => {
        const wm = new WatcherManager();
        let count = 0;

        wm.registerExistenceWatcher('/test', () => {
          count += 1;
        });
        wm.emit({
          type: Event.NODE_CHILDREN_CHANGED,
          path: '/test',
        });

        expect(count).toEqual(0);
      });
    });

    describe('NODE_DELETED events', () => {
      it('notifies child watchers.', () => {
        const wm = new WatcherManager();
        let count = 0;

        wm.registerChildWatcher('/test', () => {
          count += 1;
        });
        wm.emit({
          type: Event.NODE_DELETED,
          path: '/test',
        });

        expect(count).toEqual(1);
      });

      it('notifies data watchers.', () => {
        const wm = new WatcherManager();
        let count = 0;

        wm.registerDataWatcher('/test', () => {
          count += 1;
        });
        wm.emit({
          type: Event.NODE_DELETED,
          path: '/test',
        });

        expect(count).toEqual(1);
      });

      it('does not notify existence watchers.', () => {
        const wm = new WatcherManager();
        let count = 0;

        wm.registerExistenceWatcher('/test', () => {
          count += 1;
        });
        wm.emit({
          type: Event.NODE_DELETED,
          path: '/test',
        });

        expect(count).toEqual(0);
      });
    });
  });
});
