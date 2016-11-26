var express = require('express');
var app = express();

// You run the server from `server`, so `../client/build` is `server/../client/bu
// '..' means "go up one directory", so this translates into `client/build`!

app.use(express.static('../client/build'));

app.listen(3000, function () {
  console.log('Example app listening on port 3000!');
});
