var express = require('express');
var app = express();
var TestModule = require('./util.js');
var Reverse = TestModule.reverseString;
var bodyParser = require('body-parser');

app.use(bodyParser.text());

app.get('/', function (req, res) {
  res.send('Hello World!');
});

app.listen(3000, function () {
  console.log('Example app listening on port 3000!');
});

app.post('/reverse', function (req, res) {
  if(typeof(req.body) === 'string') {
    var reversed = Reverse(req.body);
    res.send(reversed);
  }
  else {
    res.send(400).end()
  }
});
