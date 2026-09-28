const { cloudinary } = require('../config/cloudinaryConfig');

const flattenFiles = (files) => (
  Array.isArray(files) ? files : Object.values(files || {}).flat()
);

const uploadBuffer = (file, options = {}) => new Promise((resolve, reject) => {
  if (!file?.buffer) return reject(new TypeError('A buffered upload file is required'));

  const stream = cloudinary.uploader.upload_stream(
    {
      folder: options.folder || process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury',
      resource_type: options.resourceType || 'image',
      use_filename: false,
      unique_filename: true,
      overwrite: false,
      ...options.uploadOptions,
    },
    (error, result) => (error ? reject(error) : resolve({
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      resourceType: result.resource_type,
      deliveryType: result.type,
    })),
  );

  stream.end(file.buffer);
});

const deleteAsset = async (publicId, resourceType = 'image', deliveryType = 'upload') => {
  if (!publicId) return null;
  try {
    return await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      type: deliveryType,
      invalidate: true,
    });
  } catch (error) {
    console.error('Cloudinary asset deletion failed', { publicId, message: error.message });
    return null;
  }
};

const deleteAssets = (assets = []) => Promise.all(
  assets.filter((asset) => asset?.publicId)
    .map((asset) => deleteAsset(asset.publicId, asset.resourceType, asset.deliveryType)),
);

module.exports = { flattenFiles, uploadBuffer, deleteAsset, deleteAssets };
