const appDb = db.getSiblingDB('facebook_archive');
appDb.createUser({
  user: process.env.MONGO_ARCHIVE_USERNAME || 'archive',
  pwd: process.env.MONGO_ARCHIVE_PASSWORD,
  roles: [{ role: 'readWrite', db: 'facebook_archive' }],
});
