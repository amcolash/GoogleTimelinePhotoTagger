#!/usr/bin/env node

const fs = require('fs');
const lerp = require('lerp');
const moment = require('moment');
const tj = require('@mapbox/togeojson');
const DOMParser = require('xmldom').DOMParser;
const exiftool = require('node-exiftool');
const ep = new exiftool.ExiftoolProcess();

const extensions = [ ".jpg", ".png", ".tiff", ".cr2", ".raw", ".dng" ];

/**
 * This script will geo tag photos based on a google timeline kml file. I made this for my Canon T5I,
 * so it should work for other Canons at least. Send a pull request or make an issue if things are not
 * working for your photos. Check the README for more info.
 */

var converted; // global converted kml data, gets defined after it is loaded

// Kick things off and check arg usage
checkArgs();

function checkArgs() {
  var args = [];

  // Parse out the node path from the args (if supplied)
  for (var i = 0; i < process.argv.length; i++) {
    var arg = process.argv[i];
    if (!arg.includes("/node")) {
      args.push(arg);
    }
  }

  // If something went wrong with the usage
  if (args.length < 3 || !args[1].endsWith(".kml")) {
    console.error("usage: timeline.js [location_history.kml] [images_path]");
    process.exit(1);
  }

  // Start loading now
  loadKml(args[1], args[2]);
}

var coordinates = [];

function loadKml(location_path, image_path) {
  // Load our passed in location file
  var kml = new DOMParser().parseFromString(fs.readFileSync(location_path, 'utf8'));
  converted = tj.kml(kml);

  console.log("starting to get all image metadata (this will take a bit)");

  // Open up exiftool and wait for it to start
  ep.open()
    // Get metadata for all readable files in the given directory
    .then(() => ep.readMetadata(image_path, ['-File:all']))
    // After we have gotten the data, then start to tag each file returned
    .then((res) => {
      // console.log(res);

      // If we got something back...
      if (res.data) {
        console.log("got all metadata");

        var index = -1;

        // Sort file list by file name
        res.data = res.data.sort(function(a, b) {
          return a.SourceFile.localeCompare(b.SourceFile);
        });

        // Yikes, callback fun
        function next() {
          index++;

          if (index < res.data.length) {
            // Handle next photo
            var data = res.data[index];

            var name = data.SourceFile.toLowerCase();
            var matches = false;
            for (var i = 0; i < extensions.length; i++) {
              if (name.endsWith(extensions[i])) {
                matches = true;
                break;
              }
            }
            if (!matches) {
              next();
              return;
            }

            var time = getTime(data);
            var coords = getCoordinates(time);

            // If we parsed the time correcrly and got coordinates
            if (coords) {
              // Modify existing data
              data.GPSLongitudeRef =  'W';
              data.GPSLongitude = coords.lng;
              data.GPSLatitudeRef = 'N';
              data.GPSLatitude = coords.lat;

              coordinates.push([coords.lat, coords.lng]);

              // Write new exif data
              console.log("writing: " + data.SourceFile + ", " + JSON.stringify(coords) + " @ " + time.toString());
              ep.writeMetadata(data.SourceFile, data, ['overwrite_original']).then(function(res) {
                next();
              });
            } else {
              next();
            }
          } else {
            // All done
            console.log("Closing Up");
            ep.close();
            console.log("Happy tagging!");

            console.log(JSON.stringify(coordinates));
          }
        }

        next();
      }
    })
}

function getTime(data) {
  var dataTime = data.DateTimeOriginal || data.CreateDate || data.ModifyDate;

  // If we have a date/time from the exif data
  if (dataTime) {
    // Assuming format 'YYYY:MM:DD hh:mm:ss'
    var parts = dataTime.split(" ");
    parts[0] = parts[0].replace(/:/g, "-");
    var time = moment.utc(parts[0] + "T" + parts[1] + "Z");

    // If the exif data has a timezone, add it to find the UTC time
    if (data.TimeZone) {
      // Assuming format '+-hh:mm'
      var splitZone = data.TimeZone.split(":");
      var sign = Math.sign(splitZone[0]);

      // Add the offset to the found time
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
    // Loop through each feature in the kml and get some data from it
    var feature = converted.features[i];
    var start = moment.utc(feature.properties.timespan.begin);
    var end = moment.utc(feature.properties.timespan.end);

    // Assuming there is only one segment per time range (which should be a valid assumption except when starting to move)
    if (searchTime.isBetween(start, end) || searchTime.isSame(start) || searchTime.isSame(end)) {
      //console.log("Found matching segment - start time: " + start.toString());
      //console.log("Found matching segment - end time: " + end.toString());
      //console.log(JSON.stringify(feature))


      if (feature.geometry.type === "Point") {
        var geo = feature.geometry;
        return {
          lat: geo.coordinates[0],
          lng: geo.coordinates[1],
          name: feature.properties ? feature.properties.name : ""
        };
      }

      for (var j = 0; j < feature.geometry.geometries.length; j++) {
        var geo = feature.geometry.geometries[j];

        // Assuming google always give a line string for each section of the timeline data
        if (geo.type === "LineString") {

          if (geo.coordinates.length === 1) {
            // Simple case
            var lat = geo.coordinates[0][1];
            var lng = geo.coordinates[0][0];
          } else {
            // If we have more than one point, we are assuming that we are moving at a constant velocity
            // Figure out where we are on the path
            var totalDuration = end.diff(start);
            var partialDuration = searchTime.diff(start);
            var percent = partialDuration / totalDuration;

            // Find which coordinates to lerp between
            var index = percent * (geo.coordinates.length - 1);
            var fraction = index - Math.floor(index);
            index = Math.floor(index); // floor index now

            // Lerp between closest points
            var lat = lerp(geo.coordinates[index][1], geo.coordinates[index + 1][1], fraction);
            var lng = lerp(geo.coordinates[index][0], geo.coordinates[index + 1][0], fraction);
          }

          // Return our coordinates
          return {
            lat: lat,
            lng: lng,
            name: feature.properties.name
          };
        }
      }
    }
  }
}
