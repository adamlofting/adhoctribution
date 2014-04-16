var express = require("express");
var logfmt = require("logfmt");
var util = require("./lib/util");
var logic = require("./lib/logic");
var data = require("./lib/data");
var enforce = require('express-sslify');
var helmet = require('helmet');

var app = express();

// set up handlebars view engine
var handlebars = require('express3-handlebars').create({
  defaultLayout: 'main'
});
app.engine('handlebars', handlebars.engine);
app.set('view engine', 'handlebars');

app.use(logfmt.requestLogger());
app.use(express.favicon());
app.configure('production', function () {
  app.use(enforce.HTTPS(true));
});
app.use(express.urlencoded());
app.use(express.cookieParser(process.env.COOKIE_SECRET));
app.use(express.session({
  secret: process.env.SESSION_SECRET
}));
app.use(express.csrf());
app.use(function (req, res, next) {
  res.cookie('XSRF-TOKEN', req.csrfToken());
  res.locals.token = req.csrfToken();
  next();
});
app.use(helmet.hsts()); // HTTP Strict Transport Security
app.use(helmet.xframe('deny')); // X-Frame-Options
app.use(app.router);
app.use(express.static(__dirname + '/public'));
app.use('/bower', express.static(__dirname + '/bower_components'));

// middleware to restrict access to internal routes
function restrict(req, res, next) {
  if (req.session.authorized) {
    next();
  } else {
    req.session.targetURL = req.url;
    res.redirect('/');
  }
}

// persona
require("express-persona")(app, {
  audience: process.env.HOST + ":" + process.env.PORT, // Must match your browser's address bar
  verifyResponse: function (err, req, res, email) {
    if (util.endsWith(email, "mozillafoundation.org")) {
      req.session.authorized = true;
      res.json({
        status: "okay",
        email: email
      });
      return;
    }
    console.log("Login attempt by: ", req.session.email);
    res.json({
      status: "failure",
      reason: "Only users with a mozillafoundation.org email address may use this tool"
    });
  },
  logoutResponse: function (err, req, res) {
    if (req.session.authorized) {
      req.session.authorized = null;
    }

    res.json({
      status: "okay"
    });
  }
});

// routes
app.get('/', function (req, res) {
  if (req.session.authorized) {
    if (req.session.targetURL) {
      res.redirect(req.session.targetURL);
    } else {
      res.redirect('/log-em');
    }
  } else {
    var email = req.session.email;
    res.render('home', {
      currentUser: email,
      authorized: (req.session.authorized)
    });
  }
});

app.get('/log-em', restrict, function (req, res) {
  var email = req.session.email;
  var username = email.replace("@mozillafoundation.org", "");
  var templateValues = {
    currentUser: email,
    username: username,
    authorized: (req.session.authorized)
  };
  // pre-populate fields via URL for repeat use
  if (req.query.team) {
    templateValues.team = util.clean(decodeURI(req.query.team));
  }
  if (req.query.type) {
    templateValues.type = util.clean(decodeURI(req.query.type));
  }
  if (req.query.description) {
    templateValues.description = util.clean(decodeURI(req.query.description));
  }
  if (req.query.date) {
    templateValues.date = util.clean(decodeURI(req.query.date));
  }

  data.recentlyLogged(email, function gotRecentlyLogged(err, results) {
    var recent = util.cleanRecentForPresentation(results);
    templateValues.recentlyLogged = recent;
    res.render('log-em', templateValues);
  });
});

app.post('/log-em', restrict, function (req, res) {
  logic.processForm(req.body, req.session.email, function processedForm(err, response) {
    if (err) {
      console.error(err);
    }
    res.redirect('/log-em#logged');
  });
});

app.get('/delete', restrict, function (req, res) {
  var toDelete = {
    logged_by: req.session.email,
    contributor_id: req.query.contributor_id,
    contribution_date: req.query.contribution_date,
    mofo_team: req.query.mofo_team,
    data_bucket: req.query.data_bucket
  };
  data.deleteItem(toDelete, function deletedItem(err, response) {
    console.log("deleted", req.session.email);
    res.redirect('/log-em#logged');
  });
});

app.get('/api', function (req, res) {
  var date = null;
  var team = null;
  var bucket = null;

  if (req.query.date) {
    date = new Date(req.query.date);
    if (Object.prototype.toString.call(date) === "[object Date]") {
      if (isNaN(date.getTime())) {
        date = null; // date is not valid
      }
    } else {
      date = null;
    }
  }

  if (!date) {
    res.end('Missing parameter: "date". Must be in this format: YYYY-MM-DD.');
    return;
  }

  team = req.query.team;
  if (!team) {
    res.end('Missing parameter: "team". E.g. webmaker, openbadges, opennews, appmaker, sciencelab, engagement');
    return;
  }

  bucket = req.query.bucket;
  if (!bucket) {
    res.end('Missing parameter: "bucket". E.g. code, content, events, training, community, testing, apis');
    return;
  }

  data.getContributorCounts(date, team, bucket, function gotCounts(err, result) {
    res.json(result);
  });
});

var port = Number(process.env.PORT || 5000);
app.listen(port, function () {
  console.log("Listening on " + port);
});
