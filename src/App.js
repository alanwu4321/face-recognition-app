import React, { Component } from 'react';
import Particles from 'react-particles-js';
import Clarifai from 'clarifai';
import FaceRecognition from './components/FaceRecognition/FaceRecognition';
import Navigation from './components/Navigation/Navigation';
import Signin from './components/Signin/Signin';
import Register from './components/Register/Register';
import Logo from './components/Logo/Logo';
import ImageLinkForm from './components/ImageLinkForm/ImageLinkForm';
import Rank from './components/Rank/Rank';
import './App.css';
import ColorDetect from './components/ColorDetect/ColorDetect';
import CelebDetect from './components/CelebDetect/CelebDetect';

const app = new Clarifai.App({
  apiKey: process.env.REACT_APP_API_KEY
});

const particlesOptions = {
  particles: {
    number: {
      value: 30,
      density: {
        enable: true,
        value_area: 800
      }
    }
  }
}

class App extends Component {
  constructor() {
    super();
    this.state = {
      input: '',
      imageUrl: '',
      box: {},
      celebMatch: {},
      dominateColor: {},
      route: 'signin',
      isSignedIn: false,
      user: {
        id: '',
        name: '',
        email: '',
        entries: 0,
        joined: ''
      }
    }
  }

  //Configure Env varibles
  componentDidMount() {
    require('dotenv').config()
  }

  uploadPicture = (input, callback) => {
    const rawUrl = process.env.REACT_APP_LAMDA_ENDPOINT + 'upload/inputURL'
    fetch(rawUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "userInput": input
      })
    })
      .then(response => response.json())
      .then(inputURL => {
        var url = process.env.REACT_APP_S3_ENDPOINT + inputURL.fileName
        callback(url)
      })
  }


  onFaceDetect = (dataURL, callback) => {
    fetch(process.env.REACT_APP_LAMDA_ENDPOINT + 'upload/imgData', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "imageData": dataURL
      })
    })
      .then(response => response.json())
      .then(s3Meta => {
        callback(s3Meta.fileName)
      })
  }


  calculateFaceLocation = (data) => {
    const clarifaiFace = data.outputs[0].data.regions[0].region_info.bounding_box;
    const image = document.getElementById('inputimage');
    const width = Number(image.width);
    const height = Number(image.height);

    return {
      leftCol: clarifaiFace.left_col * width,
      topRow: clarifaiFace.top_row * height,
      rightCol: width - (clarifaiFace.right_col * width),
      bottomRow: height - (clarifaiFace.bottom_row * height)
    }
  }

  //Duplicate input image on Canvas and store the "face" in AWS S3 Bucket
  duplicateImage = (box, callback) => {
    //Dom elements
    const tempCanvas = document.getElementById("canvasTemp");
    const faceCanvas = document.getElementById("canvasFace");
    const image = document.getElementById('inputimage');

    //Convert to Canvas
    var ctx = tempCanvas.getContext("2d");
    var ctxFace = faceCanvas.getContext("2d");
    var BoxWidth = 500 - box.leftCol - box.rightCol
    var BoxHeight = image.height - box.bottomRow - box.topRow

    ctx.drawImage(image, 0, 0, image.width, image.height);

    //Print face ImageData on new Canvas 
    var imageData = ctx.getImageData(box.leftCol, box.topRow, BoxWidth, BoxHeight);
    ctxFace.putImageData(imageData, 0, 0);

    //Pass the DataURL to server for S3 storing
    var faceCanvasData = faceCanvas.toDataURL();

    //onFaceDetect will return a S3 URL Key
    //Pass the Key in API to detect color and celeb match
    this.onFaceDetect(faceCanvasData, (res) => {
      var url = process.env.REACT_APP_S3_ENDPOINT + res
      app.models
        .predict(
          'e466caa0619f444ab97497640cefc4dc',
          url)
        .then(response => {
          var celebMatch = response.outputs[0].data.regions[0].data.concepts[0].name
          this.setState({ celebMatch: { name: celebMatch } })
        })

      app.models
        .predict(
          Clarifai.COLOR_MODEL,
          url)
        .then(response => {

          var convert = require('color-convert');
          //get the hex and rgb output for the API
          const raw_hex = response.outputs[0].data.colors[0].raw_hex
          const api_rgb = convert.hex.rgb(raw_hex)
          const hex_name = response.outputs[0].data.colors[0].w3c.name

          //Traverse through each pixel on the face to find average color
          // only visit every 5 pixels
          var blockSize = 5, 
            i = -4,
            length,
            rgb = { r: 0, g: 0, b: 0 },
            count = 0;
          length = imageData.data.length;
          while ((i += blockSize * 4) < length) {
            ++count;
            rgb.r += imageData.data[i];
            rgb.g += imageData.data[i + 1];
            rgb.b += imageData.data[i + 2];
          }
          rgb.r = ~~(rgb.r / count);
          rgb.g = ~~(rgb.g / count);
          rgb.b = ~~(rgb.b / count);

          //Average results I calculated and the results return by API
          var averageRed = (rgb.r + api_rgb[0]) / 2
          var averageGreen = (rgb.g + api_rgb[1]) / 2
          var averageBlue = (rgb.b + api_rgb[2]) / 2
          var average_dominateHex = "#" + convert.rgb.hex(averageRed, averageGreen, averageBlue)
          this.setState({ dominateColor: { hex: average_dominateHex, name: hex_name, red: averageRed / 254 } });
        })
    })
  }

  displayFaceBox = (box) => {
    this.setState({ box: box });
  }

  onInputChange = (event) => {
    this.setState({ input: event.target.value });
  }

  loadUser = (data) => {
    this.setState({
      user: {
        id: data._id,
        name: data.name,
        email: data.email,
        entries: data.entries,
        joined: data.joined
      }
    })
  }

  onButtonSubmit = () => {
    this.uploadPicture(this.state.input, (imgSource) => {
      this.setState({ imageUrl: imgSource });
      app.models
        .predict(
          Clarifai.FACE_DETECT_MODEL,
          imgSource)
        .then(response => {
          // if (response) {
          //   
          //   fetch('http://localhost:3000/image', {
          //     method: 'put',
          //     headers: {'Content-Type': 'application/json'},
          //     body: JSON.stringify({
          //       id: this.state.user.id
          //     })
          //   })
          //     .then(response => response.json())
          //     .then(count => {
          //       this.setState(Object.assign(this.state.user, { entries: count}))
          //     })

          // }
          const box = this.calculateFaceLocation(response)
          this.displayFaceBox(box);
          this.duplicateImage(box);
        })
        .catch(err => console.log(err));

    })
  }

  onRouteChange = (route) => {
    if (route === 'signout') {
      this.setState({ isSignedIn: false })
    } else if (route === 'home') {
      this.setState({ isSignedIn: true })
    }
    this.setState({ route: route });
  }

  render() {
    const { isSignedIn, imageUrl, route, box, dominateColor, celebMatch } = this.state;
    return (
      <div className="App">
        <Particles className='particles'
          params={particlesOptions}
        />

        <Navigation isSignedIn={isSignedIn} onRouteChange={this.onRouteChange} />
        {route === 'home'
          ? <div>
            <Logo />
            <Rank
              name={this.state.user.name}
              entries={this.state.user.entries}
            />
            <ColorDetect dominateColor={dominateColor} />
            <CelebDetect celebMatch={celebMatch} />
            <ImageLinkForm
              onInputChange={this.onInputChange}
              onButtonSubmit={this.onButtonSubmit}
            />
            <FaceRecognition box={box} imageUrl={imageUrl} />
          </div>
          : (
            route === 'signin'
              ? <Signin loadUser={this.loadUser} onRouteChange={this.onRouteChange} />
              : <Register loadUser={this.loadUser} onRouteChange={this.onRouteChange} />
          )
        }
      </div>
    );
  }
}

export default App;
