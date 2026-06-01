import AsyncStorage from '@react-native-async-storage/async-storage';
import { PersistAdapter } from './walkSession';

const KEY = 'meong.walk.inprogress';
export const asyncStorageAdapter: PersistAdapter = {
  save: (s) => AsyncStorage.setItem(KEY, s),
  load: () => AsyncStorage.getItem(KEY),
  clear: () => AsyncStorage.removeItem(KEY),
};
