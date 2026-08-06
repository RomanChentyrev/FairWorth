const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const backupScript = path.resolve(__dirname, '../../deploy/scripts/backup-postgres.sh');

function executable(file, source) {
  fs.writeFileSync(file, source, { mode: 0o755 });
}

test('backup script verifies a dump, uploads it and rotates both copies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tripalora-backup-'));
  const bin = path.join(root, 'bin');
  const backups = path.join(root, 'backups');
  const serverEnv = path.join(root, 'server.env');
  const backupEnv = path.join(root, 'backup.env');
  const rcloneLog = path.join(root, 'rclone.log');
  fs.mkdirSync(bin);
  fs.mkdirSync(backups);
  fs.writeFileSync(serverEnv, 'DATABASE_URL=postgresql://example.invalid/tripalora\n');
  fs.writeFileSync(backupEnv, [
    'BACKUP_RETENTION_DAYS=14',
    'BACKUP_REMOTE_RETENTION_DAYS=90',
    'BACKUP_S3_ENABLED=true',
    'BACKUP_S3_PROVIDER=Other',
    'BACKUP_S3_ENDPOINT=https://s3.example.invalid',
    'BACKUP_S3_REGION=eu-test-1',
    'BACKUP_S3_BUCKET=tripalora-backups',
    'BACKUP_S3_PREFIX=production/postgres',
    'BACKUP_S3_ACCESS_KEY_ID=test-access-key',
    'BACKUP_S3_SECRET_ACCESS_KEY=test-secret-key',
    '',
  ].join('\n'));
  executable(path.join(bin, 'docker'), `#!/bin/sh
case "$*" in
  *pg_dump*) printf 'PGDMP-test-backup' ;;
  *pg_restore*) exit 0 ;;
  *) exit 1 ;;
esac
`);
  executable(path.join(bin, 'rclone'), `#!/bin/sh
printf '%s\\n' "$*" >> "$RCLONE_LOG"
`);

  const result = spawnSync('sh', [backupScript, serverEnv, backups, backupEnv], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RCLONE_LOG: rcloneLog },
  });

  assert.equal(result.status, 0, result.stderr);
  const files = fs.readdirSync(backups);
  assert.equal(files.filter(file => /^fairworth-.*\.dump$/.test(file)).length, 1);
  assert.equal(files.some(file => file.endsWith('.tmp')), false);
  assert.match(fs.readFileSync(rcloneLog, 'utf8'), /copyto .*tripalorabackups:tripalora-backups\/production\/postgres\/fairworth-/);
  assert.match(fs.readFileSync(rcloneLog, 'utf8'), /delete tripalorabackups:tripalora-backups\/production\/postgres .*--min-age 90d/);
});
