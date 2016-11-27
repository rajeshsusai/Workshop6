var express = require('express');
var app = express();
var readDocument = require('./database.js').readDocument
var StatusUpdateSchema = require('./schemas/statusupdate.json');
var validate = require('express-jsonschema').validate;
var writeDocument = require('./database.js').writeDocument;
var addDocument = require('./database.js').addDocument;
var bodyParser = require('body-parser')
var database = require('./database.js');
var CommentSchema = require('./schemas/comment.json');

app.use(bodyParser.text());
app.use(bodyParser.json());

// You run the server from `server`, so `../client/build` is `server/../client/bu
// '..' means "go up one directory", so this translates into `client/build`!

app.use(express.static('../client/build'));

function getFeedItemSync(feedItemId) {
var feedItem = readDocument('feedItems', feedItemId); // Resolve 'like' counter.
feedItem.likeCounter = feedItem.likeCounter.map((id) =>
readDocument('users', id));
// Assuming a StatusUpdate. If we had other types of
// FeedItems in the DB, we would
// need to check the type and have logic for each type.
feedItem.contents.author = readDocument('users',feedItem.contents.author);
  // Resolve comment author.
  feedItem.comments.forEach((comment) => {
    comment.author = readDocument('users', comment.author);
});
return feedItem;
}
/**
 * Get the feed data for a particular user.
*/
function getFeedData(user) {
var userData = readDocument('users', user);
var feedData = readDocument('feeds', userData.feed);
// While map takes a callback, it is synchronous,
// not asynchronous. It calls the callback immediately.
feedData.contents = feedData.contents.map(getFeedItemSync);
// Return FeedData with resolved references.
return feedData;
}

function getUserIdFromToken(authorizationLine) {
  try {
    var token = authorizationLine.slice(7);
    var regularString = new Buffer(token, 'base64').toString('utf8');
    var tokenObj = JSON.parse(regularString);
    var id = tokenObj['id'];
    if(typeof id === 'number') {
      return id;
    }
    else {
      return -1;
    }
  }
  catch (e) {
    return -1;
  }
}

app.get('/user/:userid/feed', function(req, res) {
  var userid = req.params.userid;
  var fromUser = getUserIdFromToken(req.get('Authorization'));
  var useridNumber = parseInt(userid, 10);
  if(fromUser === useridNumber) {
    res.send(getFeedData(userid));
  }
  else {
    res.status(401).end();
  }
});

function postStatusUpdate(user, location, contents) {
  var time = new Date().getTime();
  var newStatusUpdate = {
    "likeCounter": [],
    "type": "statusUpdate",
    "contents": {
      "author": user,
      "postDate": time,
      "location": location,
      "contents": contents,
      "likeCounter": []
    },
    "comments": []
  };
  newStatusUpdate = addDocument('feedItems', newStatusUpdate);
  var userData = readDocument('users', user);
  var feedData = readDocument('feeds', userData.feed);
  feedData.contents.unshift(newStatusUpdate._id);
  writeDocument('feeds', feedData);
  return newStatusUpdate;
}

function postComment(feedItemId, body) {
  var feedItem = readDocument('feedItems', feedItemId);
  var comment = {
    "author": body.author,
    "contents": body.contents,
    "postDate": body.postDate,
    "likeCounter": []
  };
  feedItem.comments.push(comment);
  writeDocument('feedItems', feedItem);
  return feedItem;
}

app.post('/feeditem/:feeditemid/commentthread/', validate({body: CommentSchema}), function(req, res) {
  var body = req.body;
  var fromUser = getUserIdFromToken(req.get('Authorization'));
  var feedItemId = parseInt(req.params.feeditemid, 10);

  if(fromUser === body.author) {
    var comment = postComment(feedItemId, body);
    res.status(201);
    res.set('Location', '/feeditem/' + feedItemId + '/commentthread');
    res.send(getFeedItemSync(feedItemId));
  }
  else {
    res.status(401).end();
  }
});

app.put('/feeditem/:feeditemId/commentthread/:commentIdx/likelist/:userId', function(req, res) {
  var fromUser = getUserIdFromToken(req.get('Authorization'));
  console.log(JSON.stringify(req.params))
  var feedItemId = parseInt(req.params.feeditemId, 10);
  var commentIdx = parseInt(req.params.commentIdx, 10);
  var userId = parseInt(req.params.userId, 10);
  if(fromUser === userId) {
    var feedItem = readDocument('feedItems', feedItemId);
    var comment = feedItem.comments[commentIdx];
    comment.likeCounter.push(userId);
    writeDocument('feedItems', feedItem);
    comment.author = readDocument('users', comment.author);
    res.send(comment)
  }
  else {
    res.status(401).end();
  }
});

app.delete('/feeditem/:feeditemId/commentthread/:commentIdx/likelist/:userId', function(req, res) {
  var fromUser = getUserIdFromToken(req.get('Authorization'));
  console.log(JSON.stringify(req.params))
  var feedItemId = parseInt(req.params.feeditemId, 10);
  var commentIdx = parseInt(req.params.commentIdx, 10);
  var userId = parseInt(req.params.userId, 10);
  if(fromUser === userId) {
    var feedItem = readDocument('feedItems', feedItemId);
    var comment = feedItem.comments[commentIdx];
    var userIndex = comment.likeCounter.indexOf(userId);
    if(userIndex != -1) {
      comment.likeCounter.splice(userIndex, 1);
      writeDocument('feedItems', feedItem);
    }
    comment.author = readDocument('users', comment.author);
    res.send(comment)
  }
  else {
    res.status(401).end();
  }
});

// `POST /feeditem { userId: user, location: location, contents: contents  }`
app.post('/feeditem',
validate({ body: StatusUpdateSchema }), function(req, res) {
  // If this function runs, `req.body` passed JSON validation!
var body = req.body;
var fromUser = getUserIdFromToken(req.get('Authorization'));
// Check if requester is authorized to post this status update. // (The requester must be the author of the update.)
if (fromUser === body.userId) {
var newUpdate = postStatusUpdate(body.userId, body.location, body.contents);
// When POST creates a new resource, we should tell the client about it // in the 'Location' header and use status code 201.
res.status(201);
res.set('Location', '/feeditem/' + newUpdate._id);
     // Send the update!
res.send(newUpdate); } else {
    // 401: Unauthorized.
    res.status(401).end();
  }
});

/**
 * Translate JSON Schema Validation failures into error 400s.
*/
app.use(function(err, req, res, next) {
if (err.name === 'JsonSchemaValidation') {
    // Set a bad request http response status
res.status(400).end(); } else {
    // It's some other sort of error; pass it to next error middleware handler
next(err); }
});

app.post('/resetdb', function(req, res) {
  console.log("Resetting database...");
  database.resetDatabase();
  res.send();
});

//Update a feed item.
app.put('/feeditem/:feeditemid/content', function(req, res) {
  var fromUser = getUserIdFromToken(req.get('Authorization'));
  var feedItemId = req.params.feeditemid;
  var feedItem = readDocument('feedItems', feedItemId);
  // Check that the requester is the author of this feed item.
  if(fromUser === feedItem.contents.author) {
    //Check that the body is a string, and not something like a JSON object.
    //We can't use JSON validation here, since the body is simply text!
    if(typeof(req.body) !== 'string') {
      // 400: Bad request.
      res.status(400).end();
      return;
    }
    //Update text content of update.
    feedItem.contents.contents = req.body;
    writeDocument('feedItems', feedItem);
    res.send(getFeedItemSync(feedItemId));
  }
  else {
    // 401: Unauthorized
    res.status(401).end();
  }
});

app.delete('/feeditem/:feeditemid', function(req, res) {
  var fromUser = getUserIdFromToken(req.get('Authorization'));
  //Convert from a string into a number.
  var feedItemId = parseInt(req.params.feeditemid, 10);
  var feedItem = readDocument('feedItems', feedItemId);
  // Check that the author of the post is requesting the delete.
  if(feedItem.contents.author === fromUser) {
    database.deleteDocument('feedItems', feedItemId);
    //Remove references to this feed item from all other feeds
    var feeds = database.getCollection('feeds');
    var feedIds = Object.keys(feeds);
    feedIds.forEach((feedId) => {
      var feed = feeds[feedId];
      var itemIdx = feed.contents.indexOf(feedItemId);
      if(itemIdx !== -1) {
        // Splice out of array.
        feed.contents.splice(itemIdx, 1);
        //Update feed.
        database.writeDocument('feeds', feed);
      }
    });
    //Send a blank response to indicate success.
    res.send();
  }
  else{
    // 401: Unauthorized
    res.status(401).end();
  }
});

//Like a feed item.
app.put('/feeditem/:feeditemid/likelist/:userid', function(req, res) {
  var fromUser = getUserIdFromToken(req.get('Authorization'));
  // Convert params from string to number.
  var feedItemId = parseInt(req.params.feeditemid, 10);
  var userId = parseInt(req.params.userid, 10);
  if (fromUser === userId) {
    var feedItem = readDocument('feedItems', feedItemId);
    // Add to likeCounter if not already present.
    if (feedItem.likeCounter.indexOf(userId) === -1) {
      feedItem.likeCounter.push(userId);
      writeDocument('feedItems', feedItem);
    }
    // Return a resolved version of the likeCounter
    res.send(feedItem.likeCounter.map((userId) =>
                                      readDocument('users', userId)));
  }
  else {
    // 401: Unauthorized.
    res.status(401).end();
  }
});

// Unlike a feed item.
app.delete('/feeditem/:feeditemid/likelist/:userid', function(req, res) {
  var fromUser = getUserIdFromToken(req.get('Authorization'));
  // Convert params from string to number.
  var feedItemId = parseInt(req.params.feeditemid, 10);
  var userId = parseInt(req.params.userid, 10);
  if (fromUser === userId) {
    var feedItem = readDocument('feedItems', feedItemId);
    var likeIndex = feedItem.likeCounter.indexOf(userId);
    // Remove from likeCounter if present
    if(likeIndex != -1) {
      feedItem.likeCounter.splice(likeIndex, 1);
      writeDocument('feedItems', feedItem);
    }
    //Return a resolved version of the likeCounter
    res.send(feedItem.likeCounter.map((userId) =>
                                          readDocument('users', userId)));
  }
  else {
    // 401: Unauthorized.
    res.status(401).end();
  }
});

// Search for feed item
app.post('/search', function(req, res) {
  var fromUser = getUserIdFromToken(req.get('Authorization'));
  var user = readDocument('users', fromUser);
  if(typeof(req.body) === 'string') {
    var queryText = req.body.trim().toLowerCase();
    var feedItemIDs = readDocument('feeds', user.feed).contents;
    res.send(feedItemIDs.filter((feedItemID) => {
      var feedItem = readDocument('feedItems', feedItemID);
      return feedItem.contents.contents.toLowerCase().indexOf(queryText) !== -1;
    }).map(getFeedItemSync));
  }
  else {
    // 400: Bad Request.
    res.status(400).end();
  }
});


app.listen(3000, function () {
  console.log('Example app listening on port 3000!');
});
