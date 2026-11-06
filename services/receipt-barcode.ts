import bwipjs from 'bwip-js/node';

export function receiptBarcode(billNo: string) {
  const svg = bwipjs.toSVG({
    bcid: 'code128',
    text: billNo,
    height: 12,
    scale: 2,
    paddingwidth: 10,
    paddingheight: 4,
    backgroundcolor: 'FFFFFF',
    barcolor: '000000',
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
