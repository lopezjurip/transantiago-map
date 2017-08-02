"use strict";

const Bluebird = require("bluebird");
const _ = require("lodash");
const dotenv = require("dotenv");
const fs = require("mz/fs");
const path = require("path");

const Transantiago = require("./Transantiago");
const GoogleMaps = require("./GoogleMaps");

dotenv.config();

const transantiago = new Transantiago();
const googleMaps = new GoogleMaps(process.env.GOOGLE__MAPS__KEY);

async function main() {
  const stops = _(await transantiago.getStops()).map(_.toUpper).sortedUniq().value();
  const result = await Bluebird.map(stops, operate, { concurrency: 5 });
  return result;
}

function validate(lat, lng) {
  return _.isFinite(lat) && _.isFinite(lng) && Number(lat) !== 0 && Number(lng) !== 0;
}

async function operate(stop, index, total) {
  try {
    if (await fs.exists(path.join("success", `${stop}.json`))) {
      return console.log("CACH", index, total, stop);
    }

    await Bluebird.delay(100);

    const response = await transantiago.getStop(stop);
    if (!response["valid"]) {
      return console.log("INVALID", index, total, stop);
    }
    let lat = _.toNumber(response["x"]);
    let lng = _.toNumber(response["y"]);

    if (!validate(lat, lng)) {
      // const query = [response["paradero"], response["nomett"]].join("-"); // Google seems to like this.
      // const query = `Estación de autobuses ${response["paradero"]}, Santiago, Chile`;
      const query = `${response["paradero"]}-${response["nomett"]}, Santiago, Chile`;
      const results = await googleMaps.getPlacesByAddress(query);
      if (results === null) {
        console.error("quota over");
        process.exit(1);
      }
      const location = _.get(results, [0, "geometry", "location"], {});
      lat = location.lat;
      lng = location.lng;
      response["googleMaps"] = _.get(results, [0]);
    }

    if (!validate(lat, lng)) {
      lat = null;
      lng = null;
    }

    response["lat"] = lat;
    response["lng"] = lng;

    if (validate(lat, lng)) {
      const string = await success(stop, response);
      return console.log("TRUE", index, total, string);
    } else {
      const string = await failure(stop, response);
      return console.log("FALSE", index, total, string);
    }
  } catch (err) {
    const string = await fatal(stop, err);
    return console.log("FATAL", index, total, string);
  }
}

async function success(stop, response = {}) {
  const string = [stop, response["lat"], response["lng"], "\n"].join("\t");
  await fs.appendFile("./success.txt", string);
  const route = path.join("success", `${stop}.json`);
  await fs.writeFile(route, JSON.stringify(response, null, 2), { flag: "w" });
  return string;
}

async function failure(stop, response = {}) {
  const string = [stop, response["lat"], response["lng"], "\n"].join("\t");
  await fs.appendFile("./failure.txt", string);
  const route = path.join("failure", `${stop}.json`);
  await fs.writeFile(route, JSON.stringify(response, null, 2), { flag: "w" });
  return string;
}

async function fatal(stop, error) {
  const string = [stop, error.message, "\n"].join("\t");
  await fs.appendFile("./fatal.txt", string);
  const route = path.join("fatal", `${stop}.json`);
  await fs.writeFile(route, error.message, { flag: "w" });
  return string;
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
