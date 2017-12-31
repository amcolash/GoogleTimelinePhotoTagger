#!/usr/bin/env node

const lerp = require('lerp');
const moment = require('moment');
const tj = require('@mapbox/togeojson');
const fs = require('fs');
const DOMParser = require('xmldom').DOMParser;
const exiftool = require('node-exiftool');
const ep = new exiftool.ExiftoolProcess();

/**
 * This script will geo tag photos based on a google timeline kml file. I made this for my canon t5i,
 * so it should work for other canons at least. Send a pull request or make an issue if things are not
 * working for your photos. Check the README for more info.
 */

var converted; // global converted kml data, gets defined after it is loaded

// Kick things off and check arg usage
checkArgs();

function checkArgs() {
  var args = [];

  for (var i = 0; i < process.argv.length; i++) {
    var arg = process.argv[i];
    if (!arg.includes("/node")) {
      args.push(arg);
    }
  }

  if (args.length < 3 || !args[1].endsWith(".kml")) {
    console.error("usage: timeline.js [location_history.kml] [images_path]");
    process.exit(1);
  }

  // Start loading now
  loadKml(args[1], args[2]);
}

function loadKml(location_path, image_path) {
  var kml = new DOMParser().parseFromString(fs.readFileSync(location_path, 'utf8'));
  converted = tj.kml(kml);

  console.log("starting to get all image metadata");

  ep.open()
    .then(() => ep.readMetadata(image_path, ['-File:all']))
    .then((res) => {
      // console.log(res);
      
      if (res.data) {
        console.log("got all metadata");

        var index = -1;
        var points = [];

        res.data = res.data.sort(function(a, b) {
          return a.SourceFile.localeCompare(b.SourceFile);
        });

        function next() {
          index++;
          
          if (index < res.data.length) {
            var data = res.data[index];
            var time = getTime(data);
            var coords = getCoordinates(time);
            
            if (coords) {
              points.push(coords);

              data.GPSLongitudeRef =  'W';
              data.GPSLongitude = coords.lng;
              data.GPSLatitudeRef = 'N';
              data.GPSLatitude = coords.lat;
              
              console.log("writing: " + data.SourceFile + ", " + JSON.stringify(coords) + " @ " + time.toString());
              ep.writeMetadata(data.SourceFile, data, ['overwrite_original']).then(function(res) {
                next();
              });
            } else {
              next();
            }
          } else {
            console.log("closing up");
            console.log(JSON.stringify(points));
            ep.close();
          }
        }

        next();
      }
    })
}

function getTime(data) {
  var dataTime = data.DateTimeOriginal || data.CreateDate || data.ModifyDate;
  if (dataTime) {
    // Assuming format 'YYYY:MM:DD hh:mm:ss'
    var parts = dataTime.split(" ");
    parts[0] = parts[0].replace(/:/g, "-");
    var time = moment.utc(parts[0] + "T" + parts[1] + "Z");
    
    if (data.TimeZone) {
      // Assuming format '+-hh:mm'
      var splitZone = data.TimeZone.split(":");
      var sign = Math.sign(splitZone[0]);

      time = time.add(Math.abs(splitZone[0]), 'h');
      time = time.add(splitZone[1], 'm');
    }

    // Doing the search in UTC to match to timeline format
    // console.log("Search time: " + time.toString());

    return time;
  } else {
    console.error("Missing timestamp for " + data.SourceFile + ". Data: " + JSON.stringify(data));
  }
}

function getCoordinates(searchTime) {
  if (typeof searchTime === 'undefined') {
    console.error("Undefined search time! Unable to get coordinates.");
    return;
  }

  for (var i = 0; i < converted.features.length; i++) {
    var feature = converted.features[i];
    var start = moment.utc(feature.properties.timespan.begin);
    var end = moment.utc(feature.properties.timespan.end);
    
    
    if (searchTime.isBetween(start, end) || searchTime.isSame(start) || searchTime.isSame(end)) {
      // console.log("Found start time: " + start.toString());
      // console.log("Found end time: " + end.toString());

      for (var j = 0; j < feature.geometry.geometries.length; j++) {
        var geo = feature.geometry.geometries[j];
        if (geo.type === "LineString") {
          var totalDuration = end.diff(start);
          var partialDuration = searchTime.diff(start);
          var percent = partialDuration / totalDuration;

          if (geo.coordinates.length === 1) {
            // Simple case
            var lat = geo.coordinates[0][1];
            var lng = geo.coordinates[0][0];
          } else {
            // If we have more than one point, we are assuming that we are moving at a constant velocity

            // Find which coordinates to lerp between
            var index = percent * (geo.coordinates.length - 1);
            var fraction = index - Math.floor(index);
            index = Math.floor(index); // floor index now

            // Lerp between closest points
            var lat = lerp(geo.coordinates[index][1], geo.coordinates[index + 1][1], fraction);
            var lng = lerp(geo.coordinates[index][0], geo.coordinates[index + 1][0], fraction);
          }

          return { lat: lat, lng: lng, name: feature.properties.name };
        }
      }
    }
  }
}