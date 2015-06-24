var _ = require('underscore');
var async = require('async');
var gtfs = require('gtfs');
var jade = require('jade');
var moment = require('moment');


function formatDate(date) {
  return moment(date, 'YYYYMMDD').format('ddd, MMM D, YYYY');
}

function formatStopTime(stoptime) {
  if(!stoptime) {
    stoptime = {
      classes: ['skipped'],
      formatted_time: '&mdash;'
    };
  } else {
    stoptime.classes = [];
  }

  if(stoptime.departure_time === '') {
    stoptime.formatted_time = '***';
    stoptime.classes.push('untimed');
  } else if(stoptime.departure_time) {
    stoptime.formatted_time = moment(stoptime.departure_time, 'HH:mm:ss').format('h:mm A');
    stoptime.classes.push(moment(stoptime.departure_time, 'HH:mm:ss').format('a'));
  }

  if(stoptime.pickup_type === 2 || stoptime.pickup_type === 3) {
    stoptime.classes.push('request');
  }

  return stoptime;
}


function sortStops(stops) {
  return _.sortBy(stops, function(stop) {
    var trip = _.find(stop.trips, function(trip) {
      return trip && trip.stop_sequence !== undefined;
    });
    return trip.stop_sequence;
  });
}


function formatDays(calendar) {
  var days = [];

  if(calendar.monday === '1') {
    days.push('Mon');
  }
  if(calendar.tuesday === '1') {
    days.push('Tue');
  }
  if(calendar.wednesday === '1') {
    days.push('Wed');
  }
  if(calendar.thursday === '1') {
    days.push('Thu');
  }
  if(calendar.friday === '1') {
    days.push('Fri');
  }
  if(calendar.saturday === '1') {
    days.push('Sat');
  }
  if(calendar.sunday === '1') {
    days.push('Sun');
  }

  return days.join(' ');
}


exports.generateHTML = function(agencyKey, routeId, directionId, options, cb) {
  gtfs.getRoute(routeId, function(e, route) {
    if(e) return cb(e);

    if(!route) {
      return cb(new Error('No route found'));
    }

    gtfs.getTripsByRouteAndDirection(agencyKey, routeId, directionId, function(e, trips) {
      if(e) return cb(e);

      var stops = {};
      async.map(trips, function(trip, cb) {
        gtfs.getStoptimesByTrip(trip.trip_id, function(e, stoptimes) {
          if(e) return cb(e);

          trip.stoptimes = stoptimes;

          stoptimes.forEach(function(stoptime) {
            stops[stoptime.stop_id] = {
              trips: [],
              stop_id: stoptime.stop_id
            };
          });

          cb(null, trip);
        });
      }, function(e, trips){
        if(e) return cb(e);

        var headsign = '';

        if(!trips || !trips.length) {
          return cb(new Error('No trips found'));
        }

        trips = _.sortBy(trips, function(trip) {
          return moment(trip.stoptimes[0].departure_time, 'HH:mm:ss').format('X');
        });

        trips.forEach(function(trip) {
          _.each(stops, function(stop, stop_id) {
            stop.trips.push(formatStopTime(_.findWhere(trip.stoptimes, {stop_id: stop_id})));
          });

          headsign = headsign || trip.trip_headsign;
        });

        gtfs.getStops(_.keys(stops), function(e, stopData) {
          if(e) return cb(e);

          stopData.forEach(function(stop) {
            stops[stop.stop_id].stop_timezone = stop.stop_timezone;
            stops[stop.stop_id].stop_name = stop.stop_name;
            stops[stop.stop_id].stop_code = stop.stop_code;
          });

          var service_ids = _.pluck(trips, 'service_id');

          gtfs.getCalendarsByService(service_ids, function(e, calendars) {
            if(e) return cb(e);

            calendars = calendars.map(function(item) {
              var calendar = item.toObject();
              calendar.day_list = formatDays(calendar);
              return calendar;
            });

            trips.forEach(function(trip) {
              trip.calendar = _.findWhere(calendars, {service_id: trip.service_id});
            });

            gtfs.getCalendarDatesByService(service_ids, function(e, calendarDates) {
              if(e) return cb(e);

              var dates = _.groupBy(calendarDates, 'exception_type');

              cb(null, jade.renderFile('views/timetable.jade', {
                stops: sortStops(stops),
                headsign: headsign,
                route: route,
                calendars: calendars,
                options: options,
                excludedDates: _.map(_.pluck(dates['2'], 'date'), formatDate),
                includedDates: _.map(_.pluck(dates['1'], 'date'), formatDate)
              }));
            });
          });
        });
      });
    });
  });
};