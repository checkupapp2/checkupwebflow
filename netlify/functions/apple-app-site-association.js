const association = {
  applinks: {
    apps: [],
    details: [
      {
        appID: 'LK3B5E5FK4.com.app.CheckUp',
        paths: [
          '/events/*',
          '/event/*',
          '/courts/*',
          '/court/*',
          '/profile/*',
          '/profiles/*',
          '/post/*',
          '/posts/*',
          '/bracket/*',
          '/brackets/*',
          '/scoreboard/*',
          '/scoreboards/*',
        ],
      },
    ],
  },
};

exports.handler = async () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  },
  body: JSON.stringify(association),
});
