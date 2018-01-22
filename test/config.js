import childProcess from 'child_process';
import path from 'path';

function startZookeeper() {
  const zk = childProcess.spawn(path.resolve('ZookeeperBinary/bin/zkServer.sh'), ['start']);

  return new Promise(resolve => {
    zk.on('close', () => {
      resolve();
    });
  });
}
global.startZookeeper = startZookeeper;

function stopZookeeper() {
  const zk = childProcess.spawn(path.resolve('ZookeeperBinary/bin/zkServer.sh'), ['stop']);

  return new Promise(resolve => {
    zk.on('close', () => {
      resolve();
    });
  });
}
global.stopZookeeper = stopZookeeper;

beforeAll(() => startZookeeper());

afterAll(() => stopZookeeper());
