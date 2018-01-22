import Chance from 'chance';
import Event from '../src/Event';
import Zookeeper from '../src';

const chance = new Chance();

const testPath = `/${chance.string()}`;

describe('ZookeeperClient', () => {
  const client = Zookeeper.createClient('127.0.0.1:40000');

  beforeAll(done => {
    client.connect();
    client.once('connected', () => {
      done();
    });
  });

  afterAll(() => {
    client.close();
  });

  it('Can Connect', () => {});

  it('Can check if exists - with false', done => {
    client.exists(testPath, (error, stat) => {
      expect(stat).toBeFalsy();
      done(error);
    });
  });

  it('Can create Data', done => {
    client.create(testPath, new Buffer('test'), error => {
      done(error);
    });
  });

  it('Can check if exists - with true', done => {
    client.exists(testPath, (error, stat) => {
      expect(stat).toBeTruthy();
      done(error);
    });
  });

  it('Can get Data', done => {
    client.getData(testPath, (error, data) => {
      if (error) done(error);
      expect(data.toString('utf8')).toBe('test');
      done(error);
    });
  });

  it('Can set Data', done => {
    client.setData(testPath, new Buffer('test2'), error => {
      if (error) {
        done(error);
      } else {
        client.getData(testPath, (error2, data) => {
          if (error2) done(error2);
          expect(data.toString('utf8')).toBe('test2');
          done(error2);
        });
      }
    });
  });

  it('Can watch Data, set', done => {
    client.getData(
      testPath,
      event => {
        expect(event.path).toBe(testPath);
        expect(event.type).toBe(Event.NODE_DATA_CHANGED);
        done();
      },
      error => {
        if (error) done(error);
        else {
          client.setData(testPath, new Buffer('watchTest'), setError => {
            if (setError) done(setError);
          });
        }
      }
    );
  });

  it('Can reconnect and get Data', done => {
    // eslint-disable-next-line
    stopZookeeper()
      // eslint-disable-next-line
      .then(startZookeeper)
      .then(() => {
        client.getData(testPath, (error, data) => {
          if (error) done(data);
          expect(data.toString('utf8')).toBe('watchTest');
          done();
        });
      });
  });

  it('Can remove data', done => {
    client.remove(testPath, error => {
      done(error);
    });
  });

  it('throws exception on connection loss', done => {
    // eslint-disable-next-line
    stopZookeeper().then(() => {
      client.remove(testPath, error => {
        expect(error).toBeDefined();
        expect(error.code).toBe(-4);
        done();
      });
    });
  });
});
