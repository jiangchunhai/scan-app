import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    "name": "扫码识别",
    "slug": "saoma",
    "version": "1.0.5",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "myapp",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "ios": {
      "supportsTablet": true
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundColor": "#5EEAD4"
      },
      "package": "com.saoma.app"
    },
    "web": {
      "bundler": "metro",
      "output": "single",
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      "expo-router",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#ffffff"
        }
      ],
      [
        "expo-image-picker",
        {
          "photosPermission": "允许访问相册",
          "cameraPermission": "允许使用相机",
          "microphonePermission": "允许访问麦克风"
        }
      ],
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "需要访问位置"
        }
      ],
      [
        "expo-camera",
        {
          "cameraPermission": "允许 APP 使用摄像头扫描条形码",
          "microphonePermission": "允许使用麦克风",
          "recordAudioAndroid": true
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true
    },
    "extra": {
      "router": {},
      "eas": {
        "projectId": "ae4f2f75-e6ba-4098-abc7-2fb7046b0779"
      }
    },
    "owner": "jiangchunhais-team"
  }
}
