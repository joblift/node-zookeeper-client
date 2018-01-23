import Chance from 'chance';
// import Event from '../src/Event';
import Zookeeper from '../src';

const chance = new Chance();
const testPath = `/${chance.string()}`;

describe('Connection loss', () => {
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

  it('Fails to get Data on Connection Loss', done => {
    global.stopZookeeper().then(() => {
      client.getData(testPath, error => {
        expect(error).toBeDefined();
        expect(error.code).toBe(-4);
        done();
      });
    });
  });

  it('Can get Data on reconnect', done => {
    global.startZookeeper().then(() => {
      client.create(testPath, new Buffer('test'), error => {
        done(error);
      });
    });
  });
});
