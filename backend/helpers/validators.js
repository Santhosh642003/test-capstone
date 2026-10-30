const validator = require('validator');

exports.isValidInput = function(value){    
  return (value != null && value != undefined) ? true : false;
};

exports.isValidRequiredInput = function(value){    
  return (value != null && value != undefined && value != '') ? true : false;
};

exports.getName = function getName(name) {

  let name_split, update_name;
  for (var i = 0; i < name.length; i++) {

    if (name.charAt(i) == '\'') {
      name_split = name.split('\'');
      // update_name = new_name[0] + "''" + new_name[1]
      // return update_name
    }
  }

  if (name_split === undefined) {
    return name;
  }
  else {

    update_name = name_split[0];

    for (var i = 1; i < name_split.length; i++) {
      update_name = update_name + '\'\'' + name_split[i];
    }
  }

  return update_name;
};

exports.getPrice = function getPrice(price) {
  return price.replace('$', '').replace(',', '');
};

exports.getPhone = function getPhone(phone) {
  try{
    phone = phone.replace(/[^0-9]/g, '');
    if (phone.length != 10) {
      return null;
    } else {
      return phone;
    }
  } catch(err) {
    console.log(err);
    return null;
  }
    
};

exports.getAddress = function getAddress(address) {


  let obj = {};

  if (address.includes('-')) {
    address = address.replace(/\s+/g, ' ').trim();

    let address_list = address.split(',');
    let state_zip;
    // let obj = {}
    let address_split;
    let update_address_line_1 = address_list[0];
    let update_city;

    for (var i = 0; i < address_list[0].length; i++) {
      if (address_list[0].charAt(i) == '\'') {
        address_split = address_list[0].split('\'');
        update_address_line_1 = address_split[0] + '\'\'' + address_split[1];
        break;
      }
      else {
        update_address_line_1 = address_list[0];
      }
    }

    // let address_line1, address_line2, city, state, zip
    if (address_list.length == 3) {

      for (var i = 0; i < address_list[1].length; i++) {
        if (address_list[1].charAt(i) == '\'') {
          address_split = address_list[1].split('\'');
          update_city = address_split[0] + '\'\'' + address_split[1];
          break;
        }
        else {
          update_city = address_list[1];
        }
      }

      state_zip = address_list[2].split('-');

      // address_line1 = address_list[0]
      // city = address_list[1]
      // state = state_zip[0]
      // zip = state_zip[1]

      obj = {
        address_line1: update_address_line_1.trimStart(),
        address_line2: ''.trimStart(),
        city: update_city.trimStart(),
        state: state_zip[0].trimStart(),
        zip: state_zip[1].trimStart(),
      };
    }

    else if (address_list.length == 4) {

      update_address_line_2 = address_list[1];
      update_city = address_list[2];

      for (var i = 0; i < address_list[1].length; i++) {
        if (address_list[1].charAt(i) == '\'') {
          address_split = address_list[1].split('\'');
          update_address_line_2 = address_split[0] + '\'\'' + address_split[1];
          break;
        }
        else {
          update_address_line_2 = address_list[1];
        }
      }

      for (var i = 0; i < address_list[2].length; i++) {
        if (address_list[2].charAt(i) == '\'') {
          address_split = address_list[2].split('\'');
          update_city = address_split[0] + '\'\'' + address_split[1];
          break;
        }
        else {
          update_city = address_list[2];
        }
      }

      state_zip = address_list[3].split('-');

      // address_line1 = address_list[0]
      // address_line2 = address_list[1]
      // city = address_list[2]
      // state = state_zip[0]
      // zip = state_zip[1]

      obj = {
        address_line1: update_address_line_1.trimStart(),
        address_line2: update_address_line_2.trimStart(),
        city: update_city.trimStart(),
        state: state_zip[0].trimStart(),
        zip: state_zip[1].trimStart(),
      };

      // console.log(address_line1 + " " + address_line2 + " " + city + " " + state + " " + zip)
    }

    else if (address_list.length == 5) {

      update_address_line_2 = address_list[1];
      update_city = address_list[2];

      for (var i = 0; i < address_list[1].length; i++) {
        if (address_list[1].charAt(i) == '\'') {
          address_split = address_list[1].split('\'');
          update_address_line_2 = address_split[0] + '\'\'' + address_split[1];
          break;
        }
        else {
          update_address_line_2 = address_list[1];
        }
      }

      for (var i = 0; i < address_list[2].length; i++) {
        if (address_list[2].charAt(i) == '\'') {
          address_split = address_list[2].split('\'');
          update_city = address_split[0] + '\'\'' + address_split[1];
          break;
        }
        else {
          update_city = address_list[2];
        }
      }

      obj = {
        address_line1: update_address_line_1.trimStart(),
        address_line2: update_address_line_2.trimStart(),
        city: update_city.trimStart(),
        state: address_list[3].trimStart(),
        zip: address_list[4].trimStart(),

      };
    }


  }

  else {
    address = address.replace(/\s+/g, ' ').trim();

    let address_list = address.split(',');
    // let obj = {}
    let address_split;
    let update_address_line_1 = address_list[0];
    let update_city;


    for (var i = 0; i < address_list[0].length; i++) {
      if (address_list[0].charAt(i) == '\'') {
        address_split = address_list[0].split('\'');
        update_address_line_1 = address_split[0] + '\'\'' + address_split[1];
        break;
      }
      else {
        update_address_line_1 = address_list[0];
      }
    }

    console.log(update_address_line_1);

    if (address_list.length == 4) {

      for (var i = 0; i < address_list[1].length; i++) {
        if (address_list[1].charAt(i) == '\'') {
          address_split = address_list[1].split('\'');
          update_city = address_split[0] + '\'\'' + address_split[1];
          break;
        }
        else {
          update_city = address_list[1];
        }
      }


      obj = {

        address_line1: update_address_line_1.trimStart(),
        address_line2: ''.trimStart(),
        city: update_city.trimStart(),
        state: address_list[2].trimStart(),
        zip: address_list[3].trimStart(),

      };
    }
    if (address_list.length == 6) {
      obj = {
        address_line1: address_list[0].trimStart() + ', ' + address_list[1].trimStart(),
        address_line2: address_list[2].trimStart(),
        city: address_list[3].trimStart().trimStart(),
        state: address_list[4].trimStart(),
        zip: address_list[5].trimStart(),

      };
    }
    if (address_list.length == 5) {

      update_address_line_2 = address_list[1];
      update_city = address_list[2];

      for (var i = 0; i < address_list[1].length; i++) {
        if (address_list[1].charAt(i) == '\'') {
          address_split = address_list[1].split('\'');
          update_address_line_2 = address_split[0] + '\'\'' + address_split[1];
          break;
        }
        else {
          update_address_line_2 = address_list[1];
        }
      }

      for (var i = 0; i < address_list[2].length; i++) {
        if (address_list[2].charAt(i) == '\'') {
          address_split = address_list[2].split('\'');
          update_city = address_split[0] + '\'\'' + address_split[1];
          break;
        }
        else {
          update_city = address_list[2];
        }
      }

      obj = {
        address_line1: update_address_line_1.trimStart(),
        address_line2: update_address_line_2.trimStart(),
        city: update_city.trimStart(),
        state: address_list[3].trimStart(),
        zip: address_list[4].trimStart(),

      };
    }

  }

  console.log(obj.address_line1 + ',' + obj.address_line2 + ',' + obj.city + ',' + obj.state + ' ' + obj.zip);
  return obj;
};

exports.getText = function getText(text) {


  // text = text.replace(/\s+/g, ' ').trim()

  let text_split, update_text;

  if (text.length > 100) {
    update_text = text.substring(0, 100);
    return update_text;
  }

  for (var i = 0; i < text.length; i++) {
    if (text.charAt(i) == '\'') {
      text_split = text.split('\'');
      // update_text = text_split[0] + "''" + text_split[1]
      // console.log(update_text)
    }
  }

  if (text_split === undefined) {
    return text.replace(/\s+/g, ' ').trim();
  }
  else {

    update_text = text_split[0];

    for (var i = 1; i < text_split.length; i++) {
      update_text = update_text + '\'\'' + text_split[i];
    }
  }

  return update_text.replace(/\s+/g, ' ').trim();
};

exports.getNumber = function getNumber(number) {
  return number.replace(/[^0-9]/g, '');
};

