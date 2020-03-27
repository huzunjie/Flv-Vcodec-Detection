
// buffer合并
const mergeBuffer = (bufferArr = []) => {
  if(bufferArr.length === 0) return null;
  if(bufferArr.length === 1) return bufferArr[0];
  const totalSize = bufferArr.reduce((a, b) => a + b.byteLength, 0);
  const uint8arr = new Uint8Array(totalSize);
  let offset = 0;
  bufferArr.forEach(buf =>{
    uint8arr.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  });
  return uint8arr.buffer;
};

const unknownStatus = 'Unknown';
// 判断解码器要拿的数据是否flv、是的话是否可以用于解码了
const getFlvVcodecByBuffer = (bufferArr, loaded = false) => {
  const buffer = mergeBuffer(bufferArr);
  const waitingStatus = loaded ? unknownStatus : 'waiting';
  if(!buffer) return waitingStatus;
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 13) return waitingStatus;
  if (bytes[0] !== 0x46 || bytes[1] !== 0x4c || bytes[2] !== 0x56) {
    return 'NotFlv';
  }
  let offset = 9 + 4; // FLV header and previousTagSize0
  let status = waitingStatus;
  while (offset + 11 < bytes.length) {
    const tagType = bytes[offset];
    const dataSize = (((bytes[offset + 1] << 8) + bytes[offset + 2]) << 8) + bytes[offset + 3];
    if (offset + 11 + dataSize > bytes.length) {
      // console.log('tag data not finished, dataSize=' + dataSize);
      break;
    }
    if (tagType === 9) { // Video
      if (bytes[offset + 12] === 1) { // Raw frame data
        const vcodecVal = bytes[offset + 11] & 0x0F;
        if (vcodecVal === 7) { // H264
            status = 'H264';
        } else if (vcodecVal === 12) {
            status = 'H265';
        } else {
          status = 'Unknown';
        }
        break;
      }
    }
    offset += 11 + dataSize + 4; // (FLV Tag Header) + dataSize + PreviousTagSize
  }
  return status;
};

// 流式请求FLV数据，并判断编码类型
const getFlvVcodecByUrl = url => new Promise((resolve, reject) => {
  const abortCtrl = self.AbortController ? new self.AbortController() : null;
  const opts = {
    method: 'GET',
    mode: 'cors',
    redirect: 'follow'
  };
  if(abortCtrl) {
    opts.signal = abortCtrl.signal;
  }
  let _aborted = false;
  const abortFetch = () => {
    _aborted = true;
    abortCtrl && abortCtrl.abort();
  };
  const flvBuffers = [];
  fetch(url, opts).then(response => {
    // abort 时也会进入这里，但response为undefined
    if(response === undefined) {
      return resolve(getFlvVcodecByBuffer(flvBuffers, true));
    }

    // 获取请求数据流读取器
    const reader = response.body.getReader();
    const readBuffer = () => {
      reader.read().then(ret => {
        // _aborted 兼容浏览器不支持 abort 的场景; 或 流读取完毕
        if (_aborted || ret.done) {
          return resolve(getFlvVcodecByBuffer(flvBuffers, true));
        }

        // 将数据流接入回调泵中
        flvBuffers.push(ret.value.buffer);
        const vcodec = getFlvVcodecByBuffer(flvBuffers);
        if(vcodec === 'waiting') {
          // 递归读取，直到出判断结果
          readBuffer();
        } else {
          abortFetch();
          return resolve(vcodec);
        }
      }, () => {
        // 'FLV 媒体源数据读取失败！'
        resolve(unknownStatus);
      });
    };
    readBuffer();
  }, () => {
    // 'FLV 媒体源访问失败！'
    resolve(unknownStatus);
  });
});

// 使用示例
// getFlvVcodecByUrl('https://0gradgmt1gw4nhcja8yzdrcj1.ourdvsss.com/pl3.live.huajiao.com/live_huajiao_h265/_LC_ps3_non_h265_SD_18846924015852754131568903_OX.flv?wshc_tag=0&wsiphost=ipdbm')

