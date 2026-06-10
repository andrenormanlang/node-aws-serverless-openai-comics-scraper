const fetch = require("node-fetch");
var xmldoc = require("xmldoc");

export async function downloadData(the_url) {
  let response = await fetch.default(the_url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RSS reader)" },
  });
  let resultText = await response.text();
  return resultText;
}

function grabPic(child) {
  let atts = child.attr;
  if (atts) {
    if (atts.type && atts.type.indexOf("image") > -1) {
      return atts.url;
    }
  }
  return null;
}

function grabPicDesc(child) {
  let result = null;
  child.eachChild(function (c, index, array) {
    //console.log("A child: " + c.name);
    if (c.name.indexOf("media:description") > -1) {
      result = c.val;
    }
  });
  return result;
}

export function getXmlChannelNodeFromXMLString(str) {
  var doc = new xmldoc.XmlDocument(str);
  return doc.descendantWithPath("channel");
}

export function extractNewsDataFromXMLChannelNode(channelNode) {
  let resultingitems = [];
  let title = "Title: N/A";
  let description = "Description: N/A";
  let lastBuildDate = null;
  let imageUrl = null;
  let imageTitle = null;

  channelNode.eachChild(function (child) {
    if (child.name == "item") {
      //console.log("*** Use this item: ");
      //console.log("***");
      let newItem = {};

      child.eachChild(function (c) {
        let value = c.val;
        //console.log(child.name + ": " + child.val);
        //console.log(child);

        switch (c.name) {
          case "title":
            newItem.title = value;
            break;
          case "link":
            newItem.link = value;
            break;
          case "pubDate":
            newItem.pubDate = value;
            break;
          case "description": {
            // For expressen RSS, special content in description tag
            try {
              let val = c.val;
              if (val.search("</p>") != -1) {
                val = val.replace("<br>", "\n");
                // TODO, optimize: Do this extraction using regexp instead. It's a simple structure. Just replacing <br>, removing <p> with string.replace. And extract <img... with regexp. It's a bit overkill to do it using an xml parser.
                let descrDoc = new xmldoc.XmlDocument(
                  "<dummy>" + val + "</dummy>"
                ); // the xml parser only works with an enclosing tag (so we'll add a dummy tag)
                newItem.description = "";
                descrDoc.eachChild((subChild) => {
                  if (subChild.name == "img") {
                    if (subChild.attr && subChild.attr.src) {
                      newItem.pic = subChild.attr.src;
                    }
                  } else if (subChild.name) {
                    newItem.description += subChild.val + " ";
                  }
                });
                newItem.description = newItem.description.trim();
              } else {
                // For other sources, that don't add tags in their description
                newItem.description = value;
              }
            } catch (e) {
              console.log(
                `dl_xml_utils.extractNewsDataFromXMLChannelNode: Attempt to parse inner xml description, error was: "${e.message}" This was the description str:`
              );
              console.log(c.val);
            }
            break;
          }
          case "media:content":
            newItem.picDesc = grabPicDesc(c);
            newItem.pic = grabPic(c);
            break;
          //default: console.log("Unhandled item attribute: "+ c.name + ": " + value);
        }
      });

      //console.log(newItem);
      if (newItem.hasOwnProperty("link") && newItem.hasOwnProperty("pubDate")) {
        resultingitems.push(newItem);
      } else {
        console.log(
          "extractNewsDataFromXMLChannelNode, discarding incomplete item:"
        );
        console.log(newItem);
      }
    } else if (child.name == "title") {
      title = child.val;
    } else if (child.name == "description") {
      description = child.val;
    } else if (child.name == "image") {
      child.eachChild(function (imageChild) {
        switch (imageChild.name) {
          case "url":
            imageUrl = imageChild.val;
            break;
          case "title":
            imageTitle = imageChild.val;
            break;
        }
      });
    } else if (child.name == "lastBuildDate") {
      lastBuildDate = child.val;
      console.log("Todo, use lastBuildDate! Value: " + child.val);
    }
  });

  if (imageTitle) {
    // We prefer the inner title, at least based on DN, it's more verbose
    title = imageTitle;
  }

  return {
    items: resultingitems,
    channelHeader: { title, description, lastBuildDate, imageUrl },
  };
}

// Removes empty string attribs, since DDB doesn't like them
export function cleanAttribs(items) {
  items.forEach((item) => {
    for (var property in item) {
      if (item.hasOwnProperty(property)) {
        if (
          typeof property === "string" &&
          item[property].length == 0 &&
          property !== "subjects" &&
          property !== "support"
        ) {
          //console.log('*********** FOUND ONE: ' + property + "\t\t(" + item[property].length + ")" + "\t\t: " + item[property]);
          delete item[property];
        } else {
          //console.log("* Ok: " + property);
        }
      }
    }
  });
}

export function parseStrTimestamp(str) {
  // TODO: Ta även hänsyn till time zone i slutet av str:  Mon, 3 Jun 2019 00:06:05 +0200
  let m = str.match(/(\d+).+(\w{3}).+(20\d{2}).+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) {
    // Fallback: handle ISO 8601 and any format that Date can parse.
    const ts = Date.parse(str);
    if (!isNaN(ts)) {
      const d = new Date(ts);
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return {
        day: String(d.getUTCDate()),
        month: d.getUTCMonth() + 1,
        year: String(d.getUTCFullYear()),
        hour: String(d.getUTCHours()).padStart(2, "0"),
        minute: String(d.getUTCMinutes()).padStart(2, "0"),
        second: String(d.getUTCSeconds()).padStart(2, "0"),
      };
    }
    return null;
  }
  //console.log(m);
  if (m && m.length == 7) {
    let month = 0;
    switch (m[2]) {
      case "Jan":
        month = 1;
        break;
      case "Feb":
        month = 2;
        break;
      case "Mar":
        month = 3;
        break;
      case "Apr":
        month = 4;
        break;
      case "May":
        month = 5;
        break;
      case "Jun":
        month = 6;
        break;
      case "Jul":
        month = 7;
        break;
      case "Aug":
        month = 8;
        break;
      case "Sep":
        month = 9;
        break;
      case "Oct":
        month = 10;
        break;
      case "Nov":
        month = 11;
        break;
      case "Dec":
        month = 12;
        break;
    }
    return {
      day: m[1],
      month: month,
      year: m[3],
      hour: m[4],
      minute: m[5],
      second: m[6],
    };
  } else {
    return null;
  }
}

function to2Digits(j) {
  return ("0" + j).slice(-2);
}

/*function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}*/

// date 'd' created by 'parseStrTimestamp'
export function formatTSObj(tsObj) {
  return (
    tsObj.year +
    "-" +
    to2Digits(tsObj.month) +
    "-" +
    to2Digits(tsObj.day) +
    " " +
    tsObj.hour +
    ":" +
    tsObj.minute +
    ":" +
    tsObj.second
  );
}

export function getTimestampFromFormattedTimestamp(formattedTS) {
  let date = new Date(formattedTS);
  //console.log('*** In: ' + formattedTS + ' and out: ' + date);
  return Math.round(date.getTime() / 1000);
}
